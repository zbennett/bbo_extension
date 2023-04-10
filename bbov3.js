/*
 *  bbov3.js - Adds functionality to BBO application
 *
 *  BBO Helper browser add-on (Matthew Kidd, San Diego)
 *
 */

"use strict";

const DEBUG_LISTENERS = false;
const TRAFFIC_CONSOLE_LOGGING = false;

// App tracks state of the app based on client-server traffic. VAR not LET because
// app.pendingDD is referenced in common.js
//
// traffic - BBO client-server traffic represented as HTML for traffic logging
// trafficCounter - Integer index for indicating traffic messages
// prevWStime - Time of last communication on Websocket.
//
// thist      - Tournament history (populated from tfind.php request)
// deal       - State of current deal (being played or kibitzed)
// context_id - Changes at the start of a new deal
// tourney    - Track tournaments. Keyed by tkey (e.g. '14873~ACBL')
// pendingDD  - Tracks pending double dummy request to BSOL. Keyed by BSOL deal format
// play       - Object containing array of sequential card play (CARDPLAY) and number of
//              tricks claimed (NCLAIMED) table, as picked up from <sc_board_details>
//              messages and mh_hand.php responses. Keyed by full deal (in dot form)
//              and South handle.
// locale     - Object of language specific strings. Initialize to English in case
//              we don't see the lang.php message, though that should never happen.

var app = {
  startTime: Date.now(),
  traffic: "",
  trafficCounter: 0,
  prevWStime: 0,
  thist: {},
  table_id: 0,
  deal: undefined,
  history: [],
  context_id: 0,
  tourney: {},
  pendingDD: [],
  play: {},
  alert: {},
  prefLoaded: false,
  ShowAuctionClock: false,
  showPlayClock: false,
  lang: "en",
  locale: {
    seatName: ["South", "West", "North", "East"],
    seatLetters: "SWNE",
    honorLetters: "JQKA",
    pass: "Pass",
    dbl: "Dbl",
    rdbl: "Rdbl",
    nt: "NT",
  },
};

const _FIRST_TRICK_VALUE = {
  N: 40,
  S: 30,
  H: 30,
  D: 20,
  C: 20,
};
const _TRICK_VALUE = {
  N: 30,
  S: 30,
  H: 30,
  D: 20,
  C: 20,
};

const _FIRST_UNDERTRICK_VALUE_NV = {
  0: 50,
  1: 100,
  2: 200,
};

const _FIRST_UNDERTRICK_VALUE_V = {
  0: 100,
  1: 200,
  2: 400,
};

const _SECOND_THIRD_UNDERTRICK_VALUE_NV = {
  0: 50,
  1: 200,
  2: 400,
};

const _SECOND_THIRD_UNDERTRICK_VALUE_V = {
  0: 100,
  1: 300,
  2: 600,
};

const _SUBSEQUENT_UNDERTRICK_VALUE_NV = {
  0: 50,
  1: 300,
  2: 600,
};

const _SUBSEQUENT_UNDERTRICK_VALUE_V = {
  0: 100,
  1: 300,
  2: 600,
};

var _NS_RUBBER_POINTS = 0;
var _EW_RUBBER_POINTS = 0;
var _NS_VUL = false;
var _EW_VUL = false;
var _NS_LEG = 0;
var _EW_LEG = 0;
var _NS_RUBBER_COUNT = 0;
var _EW_RUBBER_COUNT = 0;

// User can request a specific language for the BBO interface, e.g. Danish with
// https://www.bridgebase.com/v3/?lang=da, otherwise it will use the primary language
// set in the browser.
const URLparams = new URLSearchParams(window.location.search);
app.lang = URLparams.get("lang") ?? navigator.language;
if (app.lang.indexOf("-") !== -1) {
  // Convert regional locale designations such as 'en-US' to 'en'. BBO doesn't
  // support regioanl locale designations such as 'es-419'.
  app.lang = app.lang.substring(0, app.lang.indexOf("-"));
}

// Inject JavaScript into the context of the BBO application to intercept BBO application.
// web traffic and perform urgent tasks.
injectCode();

// Initial app.locale phrases are for English
if (app.lang !== "en") {
  localePhrases();
}

document.addEventListener(
  "keydown",
  (event) => {
    if (
      !isChrome &&
      (event.key === "/" || event.key === "'") &&
      event.target.type !== "text" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      // Kill Firefox Quick Find feature. It's of no use in the BBO application
      // and the appearance of the Quick Find bar causes the BBO application to
      // rearrange elements on the page.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Only trap Alt key combinations (without other modifiers)
    if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    // It's important to use event.code here. Mac OS uses the Option/Alt key combinations
    // to generate special symbols and event.key will reflect that symbol.
    let code = event.code;
    if (code === "KeyD") {
      keycatch(code);
      analyze();
    } else if (code === "KeyP") {
      keycatch(code);
      createpbn();
    } else if (code === "KeyH") {
      keycatch(code);
      copyboard("toggle");
    } else if (code === "KeyN") {
      keycatch(code);
      toggleNameDisplay();
    } else if (code === "KeyR") {
      keycatch(code);
      copyboard("refresh");
    } else if (code === "KeyL") {
      keycatch(code);
      savetraffic();
    } else if (code === "KeyE") {
      keycatch(code);
      exportstorage();
    } else if (code === "KeyI") {
      keycatch(code);
      selectfile(importstorage);
    }

    // Override defaults, e.g. Alt+D in Firefox normally switches to the Address Bar.
    // and Alt+H is a hot key to the Help menu, etc.
    function keycatch(code) {
      console.info("BBO Helper: Alt+" + code.substr(3, 1) + " pressed.");
      event.preventDefault();
      event.stopPropagation();
    }
  },

  (err) => {
    console.error(
      "BBO Helper: handviewer.js: Failed to add keydown event listener: ",
      err
    );
  }
);

document.addEventListener("sniffer_xhr_send", function xhr(e) {
  if (DEBUG_LISTENERS) {
    console.log("sniffer_xhr_send");
  }
  if (TRAFFIC_CONSOLE_LOGGING) {
    console.log(e.detail);
  }

  if (!pref.appTrafficLogging) {
    return;
  }

  // Zero means unlimited logging.
  const maxlen = pref.appTrafficMaxKilobytes << 10;
  if (maxlen && app.traffic.length > maxlen) {
    return;
  }

  if (e.detail.method === "POST") {
    // Make the form data easy to read by adding spaces around the parameters.
    const formhtml = escapeHTML(e.detail.formdata.replace(/&/g, " & "));
    app.traffic +=
      trafficPrefix(e.timeStamp) +
      ' <span class="xhr-post">' +
      e.detail.method +
      " " +
      escapeHTML(e.detail.url) +
      "<br>\n" +
      formhtml +
      "</span></p>" +
      "\n\n";
  } else if (
    pref.appTrafficLoggingFull ||
    !e.detail.url.startsWith("assets/")
  ) {
    // Normally hide fetching of SVG icons and similar, e.g.
    // GET assets/icons/area/Icon_people.svg
    app.traffic +=
      trafficPrefix(e.timeStamp) +
      ' <span class="xhr-send">' +
      e.detail.method +
      " " +
      escapeHTML(e.detail.url) +
      "</span></p>" +
      "\n\n";
  }
});

document.addEventListener("sniffer_xhr_load", function xhr(e) {
  if (DEBUG_LISTENERS) {
    console.log("sniffer_xhr_load");
  }
  if (TRAFFIC_CONSOLE_LOGGING) {
    console.log(e.detail);
  }

  // The XML responses have responseType of 'text'. XMLHttpRequest() defines an empty
  // string as equivalent to 'text'. Capturing Solitaie / Challenge XHR POST response
  // probably requires allow JSON and/or Document format. Want to ignore images (or
  // possibly blobs or arraybuffer) returned by a GET method.
  const maxlen = pref.appTrafficMaxKilobytes << 10;
  const rt = e.detail.responseType;
  const logme =
    pref.appTrafficLogging &&
    (maxlen === 0 || app.traffic.length < maxlen) &&
    (rt === "text" || rt === "" || rt === "json" || rt === "document");

  if (logme) {
    const deltaSec = (e.detail.responseTime - e.detail.sendTime) / 1000;
    const url = e.detail.url;
    if (
      pref.appTrafficLoggingFull ||
      !url.startsWith("https://webutil.bridgebase.com/v2/languages/lang.php")
    ) {
      // Show which request the response applies to (just final foo.php part)
      const wasPHP = e.detail.method === "POST" && url.endsWith(".php");
      const phphtml = wasPHP
        ? ' <span class="xhr-post">' +
          url.substr(url.lastIndexOf("/") + 1) +
          "</span> "
        : "";

      const responseHTML =
        e.detail.response === ""
          ? escapeHTML("<empty string>")
          : escapeHTML(e.detail.response).replace(/\n/g, "<br>\n");
      app.traffic +=
        trafficPrefix(e.timeStamp) +
        "&Delta; " +
        deltaSec.toFixed(3) +
        phphtml +
        ' <span class="xhr-resp">' +
        responseHTML +
        "</span></p>" +
        "\n\n";
    } else {
      // The lang.php response contains the internationalized messages (~200 KB)
      const nbytes = e.detail.response.length;
      app.traffic +=
        trafficPrefix(e.timeStamp) +
        "&Delta; " +
        deltaSec.toFixed(3) +
        `<p>The lengthy response (${nbytes} bytes) to the lang.php request is not ` +
        "shown because full traffic logging is not enabled.</p>\n\n";
    }
  }

  processXHR(e.detail);
});

document.addEventListener("sniffer_ws_open", function ws_open(e) {
  if (DEBUG_LISTENERS) {
    console.log("sniffer_ws_open");
  }
  if (TRAFFIC_CONSOLE_LOGGING) {
    console.log(e.detail);
  }
});

document.addEventListener("sniffer_ws_send", function ws_send(e) {
  if (DEBUG_LISTENERS) {
    console.log("sniffer_ws_send");
  }
  if (TRAFFIC_CONSOLE_LOGGING) {
    console.log(e.detail);
  }

  let maxlen = pref.appTrafficMaxKilobytes << 10;

  // Exclude connection quality pings unless full logging is enabled.
  let logme =
    pref.appTrafficLogging &&
    (maxlen === 0 || app.traffic.length < maxlen) &&
    (pref.appTrafficLoggingFull ||
      !(
        e.detail.msg.startsWith("cs_ping") ||
        e.detail.msg.startsWith("cs_keepalive")
      ));

  if (logme) {
    app.trafficCounter++;
    let deltaSec = (e.timeStamp - app.prevWStime) / 1000;
    let msg = e.detail.msg.substr(0, e.detail.msg.length - 1); // Strip final \x00

    if (msg.startsWith("cs_login") && pref.appTrafficLogHidePassword) {
      // Replace user's password with asterisks so it doesn't show up in logs.
      msg = msg.replace(/\x01password=[^\x01]*/, "\x01password=********");
    }

    // Convert field separator to pipe symbol for easy of readability. Seldom
    // need to escape the HTML but be cautious just in case, e.g. user's password
    // contains an escape HTML character.
    msg = escapeHTML(msg.replace(/\x01/g, " | "));
    app.traffic +=
      trafficPrefix(e.timeStamp) +
      "&Delta; " +
      deltaSec.toFixed(3) +
      ' <span class="cs">' +
      msg +
      "</span></p>" +
      "\n\n";
    app.prevWStime = e.timeStamp;
  }

  processWebsocket(e);
});

document.addEventListener("sniffer_ws_receive", function ws_receive(e) {
  if (DEBUG_LISTENERS) {
    console.log("sniffer_ws_receive");
  }
  if (TRAFFIC_CONSOLE_LOGGING) {
    console.log(e.detail);
  }

  // Exclude connection quality ping responses, keepalive acknowledgments,
  // and user + table statistics unless full logging is enabled. Separate
  // option to exclude the feed (<sc_feed>) messages as friends and stars
  // and such log in.
  let msg = e.detail.msg;

  let maxlen = pref.appTrafficMaxKilobytes << 10;

  let logme =
    pref.appTrafficLogging &&
    (maxlen === 0 || app.traffic.length < maxlen) &&
    (pref.appTrafficLoggingFull ||
      !(
        msg.startsWith("<sc_ack") ||
        msg.startsWith("<sc_stats") ||
        (msg.startsWith("<sc_feed") && !pref.appTrafficLogFeed)
      ));

  if (logme) {
    let deltaSec = (e.timeStamp - app.prevWStime) / 1000;
    app.traffic +=
      trafficPrefix(e.timeStamp) +
      "&Delta; " +
      deltaSec.toFixed(3) +
      ' <span class="sc">' +
      escapeHTML(msg) +
      "</span></p>" +
      "\n\n";
    app.prevWStime = e.timeStamp;
  }

  processWebsocket(e);
});

// Listen for messages from the popup menu for menu items that invoke an action
// in the current tab supplied by this module.
browser.runtime.onMessage.addListener(function (msg) {
  if (msg.type !== "menu") {
    return;
  }

  switch (msg.action) {
    case "savetraffic":
      savetraffic();
      return;
  }
});

function injectCode() {
  // New technique for Manifest V3 to into code into the context of the BBO application.
  // This method is cleaner and simpler than the previous method and works fine for
  // Manifest V2 on Firefox as well.
  let s = document.createElement("script");
  s.src = browser.runtime.getURL("injectedbbo.js");
  s.onload = function () {
    this.remove();
  };
  document.head.appendChild(s);
}

function loadMiddleSection(d) {
  _NS_RUBBER_POINTS = 0;
  _EW_RUBBER_POINTS = 0;
  _NS_VUL = false;
  _EW_VUL = false;
  _NS_LEG = 0;
  _EW_LEG = 0;
  _NS_RUBBER_COUNT = 0;
  _EW_RUBBER_COUNT = 0;
  var score_div;
  var leftclassdiv;
  var lastHandEW = 0;
  var lastHandNS = 0;
  console.log("loading middle");
  console.log(d);

  leftclassdiv = document.getElementsByClassName("leftDivClass");

  if (!document.getElementById("zachsec")) {
    score_div = document.createElement("div");
    score_div.id = "zachsec";
    score_div.style =
      "padding: 0.1em 0.3em 0.3em 0.2em; " +
      "border-style: solid; border-width: 1px; border-color: #808080; " +
      "height:500px;" +
      "font-size: 24px;" +
      "background: white;";
  } else {
    score_div = document.getElementById("zachsec");
  }

  //   const ed = elDealViewer("session");
  //   const elVulPanel = ed.getElementsByClassName("vulPanelInnerPanelClass")[0];
  console.log("tag");
  let tag = document.getElementsByTagName("result-list-item");
  console.log(tag);
  for (let item of tag) {
    lastHandEW = 0;
    lastHandNS = 0;
    let cellClass = item.getElementsByClassName("cellClass");
    console.log("cell class");
    console.log(cellClass);
    let innerText =
      cellClass[1].getElementsByClassName("innerClass")[0].innerText;
    console.log("inner text");
    console.log(innerText);
    let curBid = parseBid(innerText);
    d.history.push(curBid);
    console.log(curBid);

    let curRubberPoints = calculate_rubber_points(curBid);
    console.log("curRubberPoints", curRubberPoints);
    console.log("NSPoints", _NS_RUBBER_POINTS);

    if (curBid.bidder == "N" || curBid.bidder == "S") {
      if (curRubberPoints < 0) {
        _EW_RUBBER_POINTS += Math.abs(curRubberPoints);
        lastHandEW = Math.abs(curRubberPoints);
      } else {
        _NS_RUBBER_POINTS += curRubberPoints;
        lastHandNS = curRubberPoints;
      }
    } else {
      if (curRubberPoints < 0) {
        _NS_RUBBER_POINTS += Math.abs(curRubberPoints);
        lastHandNS = Math.abs(curRubberPoints);
      } else {
        _EW_RUBBER_POINTS += curRubberPoints;
        lastHandEW = curRubberPoints;
      }
    }
    let curRubberScore = calculateRubberScore(curBid);
    calculateVul(curBid, curRubberScore);
  }
  let table = "";
  let nsvul = _NS_VUL ? "Yes" : "No";
  let ewvul = _EW_VUL ? "Yes" : "No";
  table +=
    '<table style="width:100%; border: 1px solid; ">' +
    "<tr>" +
    '<th style= "border: 1px solid;"></th>' +
    '<th style=" border: 1px solid;">N/S</th>' +
    '<th style=" border: 1px solid;">E/W</th>' +
    "</tr>";
  table +=
    "<tr>" +
    '<td style = "border: 1px solid;">Legs</td><td style = "border: 1px solid; text-align: center;">' +
    _NS_LEG +
    '</td><td style= "border: 1px solid; text-align: center;">' +
    _EW_LEG +
    "</td></tr>";
  table +=
    "<tr>" +
    '<td style = "border: 1px solid;">Vulnerable</td><td style = "border: 1px solid; text-align: center;">' +
    nsvul +
    '</td><td style= "border: 1px solid; text-align: center;">' +
    ewvul +
    "</td></tr>";
  table +=
    "<tr>" +
    '<td style = "border: 1px solid;">Last Hand Points</td><td style = "border: 1px solid; text-align: center;">' +
    lastHandNS +
    '</td><td style= "border: 1px solid; text-align: center;">' +
    lastHandEW +
    "</td></tr>";
  table +=
    "<tr>" +
    '<td style = "border: 1px solid;">Total Points</td><td style = "border: 1px solid; text-align: center;">' +
    _NS_RUBBER_POINTS +
    '</td><td style= "border: 1px solid; text-align: center;">' +
    _EW_RUBBER_POINTS +
    "</td></tr>";
  table +=
    "<tr>" +
    '<td style = "border: 1px solid;">Rubbers Won</td><td style = "border: 1px solid; text-align: center;">' +
    _NS_RUBBER_COUNT +
    '</td><td style= "border: 1px solid; text-align: center;">' +
    _EW_RUBBER_COUNT +
    "</td></tr>";
  table += "</table>";
  console.log("NS Points", _NS_RUBBER_POINTS);
  console.log("EW Points", _EW_RUBBER_POINTS);
  console.log("NS Legs", _NS_LEG);
  console.log("EW Legs", _EW_LEG);
  console.log("NS Vul", _NS_VUL);
  console.log("EW_Vul", _EW_VUL);
  console.log(d);

  score_div.innerHTML =
    "<b>Legs</b>:<br>" +
    "N/S Leg: " +
    _NS_LEG +
    " | E/W Leg: " +
    _EW_LEG +
    "<br><br><b>Vulnerable:</b><br>" +
    "N/S Vul: " +
    nsvul +
    " | E/W Vul: " +
    ewvul +
    "<br><br> <b>Last Hand:</b><br> N/S Points: " +
    lastHandNS +
    " | E/W Points: " +
    lastHandEW +
    "<br><br><b>Total Points:</b><br> N/S Points: " +
    _NS_RUBBER_POINTS +
    " | E/W Points: " +
    _EW_RUBBER_POINTS +
    "<br><br><b>Rubbers Won:</b><br> N/S: " +
    _NS_RUBBER_COUNT +
    " | E/W: " +
    _EW_RUBBER_COUNT;
  score_div.innerHTML = table;
  leftclassdiv[0].appendChild(score_div);
}

var bid = {
  level: 0,
  suit: "",
  bidder: "",
  tricks: 0,
  doubled: 0,
};

function calculate_rubber_points(bid) {
  if (bid.level == "") return;
  let points = 0;
  let vulnerable = false;

  if (bid.bidder == "N" || bid.bidder == "S") {
    vulnerable = _NS_VUL;
  } else {
    vulnerable = _EW_VUL;
  }

  let scoring_tricks = bid.tricks - 6;
  if (scoring_tricks >= bid.level) {
    let double_multiplier = Math.pow(2, bid.doubled);
    let first_trick_score = _FIRST_TRICK_VALUE[bid.suit] * double_multiplier;
    console.log("FTS", first_trick_score);
    let subsequent_tricks_score =
      _TRICK_VALUE[bid.suit] * double_multiplier * (bid.level - 1);
    console.log("STS", subsequent_tricks_score);
    let bonus = calculateBonus(bid, vulnerable);
    console.log("bonus", bonus);

    points = first_trick_score + subsequent_tricks_score + bonus;
    console.log("Points", points);
  } else {
    let score = 0;
    let undertricks = bid.level + 6 - bid.tricks;
    console.log("undertricks", undertricks);
    for (let i = 1; i < undertricks + 1; i++) {
      if (vulnerable) {
        if (i == 1) {
          score -= _FIRST_UNDERTRICK_VALUE_V[bid.doubled];
        } else if (i < 4) {
          score -= _SECOND_THIRD_UNDERTRICK_VALUE_V[bid.doubled];
        } else {
          score -= _SUBSEQUENT_UNDERTRICK_VALUE_V[bid.doubled];
        }
      } else {
        if (i == 1) {
          score -= _FIRST_UNDERTRICK_VALUE_NV[bid.doubled];
        } else if (i < 4) {
          score -= _SECOND_THIRD_UNDERTRICK_VALUE_NV[bid.doubled];
        } else {
          score -= _SUBSEQUENT_UNDERTRICK_VALUE_NV[bid.doubled];
        }
      }
    }
    points = score;
  }
  console.log("points", points);
  return points;
}

function calculateRubberScore(bid) {
  if (bid.level == "") return;
  let points = 0;
  let scoring_tricks = bid.tricks - 6;
  if (scoring_tricks >= bid.level) {
    let double_multiplier = Math.pow(2, bid.doubled);
    let first_trick_score = _FIRST_TRICK_VALUE[bid.suit] * double_multiplier;
    console.log("FTS", first_trick_score);
    let subsequent_tricks_score =
      _TRICK_VALUE[bid.suit] * double_multiplier * (bid.level - 1);
    points = first_trick_score + subsequent_tricks_score;
  }
  return points;
}

function calculateBonus(bid, vul) {
  let score = 0;
  let overtricks = bid.tricks - 6 - bid.level;
  console.log("overtricks", overtricks);

  if (bid.level == 7) {
    vul ? (score += 1500) : (score += 1000);
  } else if (bid.level == 6) {
    vul ? (score += 750) : (score += 500);
  }

  if (overtricks <= 0) return score;
  //Overtricks
  if (bid.doubled == 0) {
    score += overtricks * _TRICK_VALUE[bid.suit];
  } else if (bid.doubled == 1) {
    score += 50;
    score += overtricks * (vul ? 200 : 100);
  } else if (bid.doubled == 2) {
    score += 100;
    score += overtricks * (vul ? 400 : 200);
  }
  return score;
}

function calculateVul(bid, rubberScore) {
  if (bid.bidder == "N" || bid.bidder == "S") {
    if (rubberScore + _NS_LEG >= 100) {
      if (_NS_VUL == true) {
        if (_EW_VUL == true) {
          _NS_RUBBER_POINTS += 500;

          console.log("500 point rubber");
        } else {
          _NS_RUBBER_POINTS += 700;
          console.log("700 point rubber");
        }
        _NS_RUBBER_COUNT++;
        _NS_VUL = false;
        _EW_VUL = false;
      } else {
        _NS_VUL = true;
      }
      _NS_LEG = 0;
      _EW_LEG = 0;
    } else {
      _NS_LEG += rubberScore;
    }
  } else {
    if (rubberScore + _EW_LEG >= 100) {
      console.log("EW > 100", _EW_VUL);
      if (_EW_VUL == true) {
        if (_NS_VUL == true) {
          _EW_RUBBER_POINTS += 500;
          console.log("500 point rubber");
        } else {
          _EW_RUBBER_POINTS += 700;
          console.log("700 point rubber");
        }
        _EW_RUBBER_COUNT++;
        _NS_VUL = false;
        _EW_VUL = false;
      } else {
        _EW_VUL = true;
      }
      _NS_LEG = 0;
      _EW_LEG = 0;
    } else {
      _EW_LEG += rubberScore;
    }
  }
}

function parseBid(bidToParse) {
  let returnBid = {};
  if (bidToParse == "PASS") return returnBid;
  returnBid.level = parseInt(bidToParse.charAt(0));
  bidToParse = bidToParse.substr(1);
  returnBid.doubled = 0;

  if (bidToParse.charAt(0) == "♠") {
    returnBid.suit = "S";
  } else if (bidToParse.charAt(0) == "♦") {
    returnBid.suit = "D";
  } else if (bidToParse.charAt(0) == "♣️" || bidToParse.charAt(0) == "♣") {
    returnBid.suit = "C";
  } else if (bidToParse.charAt(0) == "♥") {
    returnBid.suit = "H";
  } else if (bidToParse.substr(0, 2) == "NT") {
    returnBid.suit = "N";
    bidToParse = bidToParse.substr(1);
  } else {
    console.log("cant figure out suit");
    console.log(bidToParse.charAt(0));
  }
  bidToParse = bidToParse.substr(1);

  returnBid.bidder = bidToParse.charAt(0);

  bidToParse = bidToParse.substr(1);

  //Check for double
  if (bidToParse.substr(0, 2) == "xx") {
    console.log("redoubled");
    returnBid.doubled = 2;
    bidToParse = bidToParse.substr(2);
  } else if (bidToParse.charAt(0) == "x") {
    returnBid.doubled = 1;
    bidToParse = bidToParse.substr(1);
    console.log("doubled");
  } else {
    console.log("doubless", bidToParse);
  }

  if (bidToParse.charAt(0) == "-") {
    returnBid.tricks = 6 + returnBid.level - parseInt(bidToParse.charAt(1));
  } else if (bidToParse.charAt(0) == "+") {
    returnBid.tricks = 6 + returnBid.level + parseInt(bidToParse.charAt(1));
  } else if (bidToParse.charAt(0) == "=") {
    returnBid.tricks = 6 + returnBid.level;
  }

  return returnBid;
}

// function loadTab() {
//   console.log("loading tab");
//   let s = document.getElementById("rightDivClass");
//   console.log(s);
//   let tabs = document.getElementsByClassName("verticalTabBarClass");
//   console.log(tabs);
//   var mycontent = document.createElement("tab-bar-button");
//   var div = document.createElement("div");
//   div.className = "verticalClass";
//   div.setAttribute("_ngcontent-ujc-c428", "");
//   var divName = document.createElement("div");
//   divName.className = "area-label";
//   divName.innerHTML = "Zach Tab";
//   divName.setAttribute("_ngcontent-ujc-c428", "");
//   div.appendChild(divName);
//   mycontent.appendChild(div);
//   //   mycontent.innerHTML(
//   //     '<div _ngcontent-ifi-c428="" class="verticalClass"><div _ngcontent-ifi-c428="" class="area-label"> ZachTab </div><!----></div>'
//   //   );
//   tabs[0].appendChild(mycontent);
//   console.log("loaded tab");
// }

async function localePhrases() {
  // The new code injection technique (for Manifest V3) usually intercepts the
  // XHR traffic too late to catch the lang.php message. So explicitly ask for
  // lang.php if BBO language is not English.

  const url =
    "https://webutil.bridgebase.com/v2/languages/lang.php?lang=" +
    app.lang +
    "&v3b=web&v3u=BBO1";

  // We don't need the entire (~200 KB) language packet because all the phrases we
  // need are near the start. Limit our request with Range header; however, servers
  // are free to ignore the range request and that appears to tbe the case for BBO.
  const response = await fetch(url, { headers: { Range: "bytes=0-1000" } });

  if (!response.ok) {
    console.warn(
      "Attempt to fetch %s failed with HTTP status code %d",
      url,
      response.status
    );
    return;
  }

  const r = await response.text();

  if (r.startsWith("<lang err")) {
    // This can happen if BBO is invoked with a undefined language, e.g.
    // https://www.bridgebase.com/v3/?lang=cn
    console.warn("BBO reported an error for lang.php response: %s", r);
    return;
  }

  // Pick off certain language specific phrases for internationalization
  // support and proper parsing of boards directly from the DOM. These look
  // like <m i="A0010" d="South"/>, where the phrase code A0010 is
  // permanent (on the word of Uday Ivantury). The quick and dirty search
  // below is probably faster than the full proper XML parsing of the message
  // because all the phrases we want are near the start.
  app.locale.seatName[0] = r.match(/(?<="A0010" d=")[^"]+(?=")/)[0];
  app.locale.seatName[1] = r.match(/(?<="A0011" d=")[^"]+(?=")/)[0];
  app.locale.seatName[2] = r.match(/(?<="A0012" d=")[^"]+(?=")/)[0];
  app.locale.seatName[3] = r.match(/(?<="A0013" d=")[^"]+(?=")/)[0];
  app.locale.honorLetters = r.match(/(?<="A0014" d=")[^"]+(?=")/)[0];
  app.locale.pass = r.match(/(?<="A0015" d=")[^"]+(?=")/)[0];
  app.locale.dbl = r.match(/(?<="A0016" d=")[^"]+(?=")/)[0];
  app.locale.rdbl = r.match(/(?<="A0017" d=")[^"]+(?=")/)[0];
  app.locale.nt = r.match(/(?<="A0019" d=")[^"]+(?=")/)[0];

  // seatLetters as supplied by BBO is N, S, E, W which violates the standard
  // BBO seat order. Rearrage to the standard order.
  let st = r.match(/(?<="A0038" d=")[^"]+(?=")/)[0];
  app.locale.seatLetters =
    st.charAt(1) + st.charAt(3) + st.charAt(0) + st.charAt(2);

  console.info(
    "Fetched %s-locale phrases; seats: %s %s %s %s, honors: %s, " +
      "calls: %s %s %s, notrump: %s",
    app.lang,
    app.locale.seatName[0],
    app.locale.seatName[1],
    app.locale.seatName[2],
    app.locale.seatName[3],
    app.locale.honorLetters,
    app.locale.pass,
    app.locale.dbl,
    app.locale.rdbl,
    app.locale.nt
  );
}

function trafficPrefix(timeStamp) {
  // Construct start of HTML for each item of traffic.
  app.trafficCounter++;

  // Almost the same as Data(Date.now()), just slightly more accurate.
  let edate = new Date(performance.timeOrigin + timeStamp);
  let localHHMMSS = edate.toLocaleTimeString();
  let localHHMMSSmsec =
    localHHMMSS.substr(0, localHHMMSS.length - 3) +
    "." +
    zeroPadInt(edate.getMilliseconds(), 3) +
    " " +
    localHHMMSS.substr(-2);

  let relTime = (timeStamp + performance.timeOrigin - app.startTime) / 1000;
  let html =
    `<p id="p${app.trafficCounter}">` +
    zeroPadInt(app.trafficCounter, 4) +
    " " +
    localHHMMSSmsec +
    (relTime >= 0 ? " +" : " ") +
    relTime.toFixed(3) +
    " ";
  return html;
}

function escapeHTML(s) {
  // This function forces the work onto the compiled C++ code in the browser.
  // It's faster than doing string replace on <, >, &, ", etc in JavaScript.
  // Useful for quick HTML escaping. Faster than doing string replacement on <, >, &, ", etc
  if (app.textarea === undefined || app.textarea === null) {
    // Create an element to do the escaping.
    app.textarea = document.createElement("textarea");
    app.textarea.id = "bh-HTMLescape";
  }

  app.textarea.hidden = true;
  app.textarea.textContent = s;
  let html = app.textarea.innerHTML;

  // Don't really need to do this except that BBO app seem to reset this element
  // undoing attempts to hide it via the HIDDEN property, style visibility, or
  // position outside the visible part of the screen.
  app.textarea.innerHTML = "";
  return html;
}

function processXHR(d) {
  // Track various information that comes back from XHR requests.
  let url = d.url;
  if (
    d.method !== "POST" ||
    d.responseType !== "text" ||
    !url.endsWith(".php")
  ) {
    return;
  }
  if (!d.response.startsWith("<?xml")) {
    return;
  } // Guard

  let php = url.substring(url.lastIndexOf("/") + 1, url.length - 4);

  if (php === "tfind") {
    const parser = new DOMParser();
    let doc = parser.parseFromString(d.response, "application/xml");
    let tournaments = doc.getElementsByTagName("tourney");
    for (let i = 0; i < tournaments.length; i++) {
      let t = tournaments[i];
      const tkey = t.getAttribute("tkey");
      let props = {};
      let attr = t.getAttributeNames();
      for (let j = 0; j < attr.length; j++) {
        if (attr[j] === "tkey") {
          continue;
        }
        props[attr[j]] = t.getAttribute(attr[j]);
      }
      app.thist[tkey] = props;
    }
  } else if (php === "mh_hand") {
    // Received in response to requests for boards when reviewing hands from
    // past sessions, including boards played at other tables. Note: during
    // a session, board (including those played at other tables) are fetched
    // via cs_get_board with a response in <sc_board_details> but once the
    // session is complete board from other tables in the "current" (but
    // completed session) are fetch via mh_hand.php

    // Kick off double dummy, populate APP.CARDPLAY, and grab real names.
    mh_hand(d.response);
  }
}

function processWebsocket(e) {
  // <cs_loginok> user logged in successfully
  // <sc_table_node> arrival at table (e.g. start of play, tournament, kibitzing)
  // <sc_reserve_table> has table_id and names of players in each seat.
  // <sc_deal> include hand dealt to player (all four hands for kibitzers)
  // <sc dummyholds table_id="#####" board="#" dummy="S456HQAD478TC679Q" />
  // <sc_convcard> style and key attributes
  // <sc_player_sit> has players seated one by one
  // <sc_allow_dd g="y"> probably controls whether GIB can be used on
  //   previously played tournament hands.
  // <sc_call_made table_id="#####" call="1NT" alert="Y" explain="12-14" />
  // <sc_play_card table_id="#####" card="HQ" />
  // <sc_round_clock table_id="#####" clock="13" round="1" round="9" />
  // (all hands at end of hand)
  // <sc_vote_request table_id="#####" requestor="airglow" type="claim"
  //   data"3" explanation="" vote="n" ds="" />
  // <sc_vote_accepted table_id="#####" type="claim" />
  // <sc_vote_accepted table_id="#####" tricks="10" />
  // <sc_claim_accepted table_id="3024185" tricks="10" />
  // <sc_player_holds>  //  Flash deal at end
  // <sc_rbr number="!" tkey="14459~vacb147744" b=""><sc_result ...
  // <sc_board_details> full play of board as XML
  // cs_leave_table | table_id=1421424 | m1=469  (you leave a table)

  let msg = e.detail.msg;

  // Don't want to waste time running the DOM parser on all message types.
  // DOM Parser works even without an <?xml version="1.0" encoding="UTF-8"?> header.
  // Server to client messages all begin with <sc. Client to server messages
  // all begin with <cs
  let mtype = msg.startsWith("<")
    ? msg.substr(1, msg.search(" ") - 1)
    : msg.substr(0, msg.search("\x01"));

  if (mtype === "sc_call_made") {
    // First check is paranoid (shouldn't be needed). Second and third check
    // avoid processing reiterations when the player becomes dummy or when the
    // player is reseated to declare the hand in the Human Declarer format.
    if (app.deal === undefined || app.deal.amDummy || app.deal.reseating) {
      return;
    }

    // If we get getting <sc_call_made> messages and the deal blast is not
    // complete, we have arrived at the table after the auction started and
    // are receiving catch-up messages. Assign these a TDIFF of 0 because we
    // have no timing information.
    //
    // Note: When you become dummy, the auction (including your bids) is repeated
    // as <sc_call_made> messages. In the Human Declarers format, the same thing
    // happens (why?) after third <sc_deal> message, just prior to the card play.
    let tdiff = app.deal.blast1_complete
      ? e.timeStamp - app.deal.lastActionTime
      : 0;

    // Faster than the DOM parser for this common message.
    let call = msg.match(/(?<= call=")\w+(?=")/)[0];

    app.deal.auction.push(call);
    app.deal.actionTime.push(tdiff);
    app.deal.lastActionTime = e.timeStamp;

    console.info(
      call.toUpperCase(),
      "call made after",
      (tdiff / 1000).toFixed(3),
      tdiff ? "sec" : "sec (joining table part way through board)"
    );
    auctionclock(tdiff);

    const ncalls = app.deal.auction.length;
    if (ncalls === 1) {
      saveCardSize();
    }

    // Check if this is the last pass at a bidding table (type = "100")
    if (
      app.table.type === "100" &&
      ncalls > 3 &&
      call === "p" &&
      app.deal.auction[ncalls - 2] === "p" &&
      app.deal.auction[ncalls - 3] === "p"
    ) {
      console.info(
        "BBO Helper: Saving board timing (final pass at bidding table)"
      );
      saveDealTiming();
      auctionclock("off");

      // Display double dummy result (usually already cached because <sc_deal>
      // message has the full hand at Bidding tables). Note: Bidding tables don't
      // generate a mh_hand PHP request.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
      //   loadMiddleSection(app);
    }

    // Check if passed out hand at a Teaching table.
    else if (
      ncalls === 4 &&
      app.table.style === "teaching" &&
      app.deal.auction[0] === "p" &&
      app.deal.auction[1] === "p" &&
      app.deal.auction[2] === "p" &&
      app.deal.auction[3] === "p"
    ) {
      console.info(
        "BBO Helper: Saving board timing (passed out hand at teaching table)"
      );
      saveDealTiming();

      // Display double dummy result (usually already cached because <sc_deal>
      // message has the full hand at Bidding tables). Note: Bidding tables don't
      // generate a mh_hand PHP request.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
    }
  } else if (mtype === "sc_card_played" && app.deal !== undefined) {
    // When a player becomes dummy the auction is reiterated along with
    // the opening lead between <sc_deal> and <sc_deal_blast_complete>
    // messages. Second criterion ignore the opening lead because it will
    // be sent again outside the <sc_deal> reiteration.
    if (!app.deal.amDummy || app.deal.blast2_complete) {
      // Faster than the DOM parser for this common message.
      let card = msg.match(/(?<= card=")[CDHS][2-9TJQKA](?=")/)[0];
      trickcard(card, e.timeStamp, false);
    }
  } else if (mtype === "cs_make_bid") {
    // User is making a bid. Include \x01 as defense against 'card='
    // appearing in the explanation for a call.
    let tdiff = e.timeStamp - app.deal.lastActionTime;

    let pos = msg.search("\x01bid=");
    let cc = msg.charCodeAt(pos + 5);
    let call =
      cc < 49 || cc > 55 ? msg.charAt(pos + 5) : msg.substr(pos + 5, 2);

    // BBO uses lowercase p,d,r for Pass, Double, and Redouble in
    // <sc_call_made> and uppercase in <cs_make_bid>. Normalize to lowercase,
    // the same treatment used in injectedbbo.js on the other side of the fence.
    const lowercall = call.length === 2 ? call : call.toLowerCase();
    app.deal.auction.push(lowercall);
    app.deal.actionTime.push(tdiff);
    app.deal.lastActionTime = e.timeStamp;
    console.info(
      call,
      "call made by you after",
      (tdiff / 1000).toFixed(3),
      "sec"
    );
    auctionclock(tdiff);

    const ncalls = app.deal.auction.length;
    if (ncalls === 1) {
      saveCardSize();
    }

    // Check if this is the last pass at a bidding table (type = "100")
    if (
      app.table.type === "100" &&
      ncalls > 3 &&
      lowercall === "p" &&
      app.deal.auction[ncalls - 2] === "p" &&
      app.deal.auction[ncalls - 3] === "p"
    ) {
      console.info(
        "BBO Helper: Saving board timing (final pass at bidding table made by you)"
      );
      saveDealTiming();
      auctionclock("off");

      // Display double dummy result (usually already cached because <sc_deal>
      // message has the full hand at Bidding tables.). Note: Bidding tables don't
      // generate a mh_hand PHP request.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
    }

    // Check if passed out hand at a Teaching table.
    else if (
      ncalls === 4 &&
      app.table.style === "teaching" &&
      app.deal.auction[0] === "p" &&
      app.deal.auction[1] === "p" &&
      app.deal.auction[2] === "p" &&
      app.deal.auction[3] === "p"
    ) {
      console.info(
        "BBO Helper: Saving board timing (passed out hand at teaching table)"
      );
      saveDealTiming();

      // Display double dummy result (usually already cached because <sc_deal>
      // message has the full hand at Bidding tables). Note: Bidding tables don't
      // generate a mh_hand PHP request.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
      //   loadMiddleSection(app);
    }
  } else if (mtype === "cs_play_card") {
    // User is playing a card
    let pos = msg.search("card=");
    let card = msg.substr(pos + 5, 2);
    trickcard(card, e.timeStamp, true);
  } else if (mtype === "sc_deal") {
    // <sc_deal> begins a series of messages terminated by <sc_deal_blast_complete>
    // that indicate actions up to current point, beginning with <sc_player_sit>
    // messages.
    //
    // <sc_deal> occurs at the start of a board and when a player becomes dummy.
    // When a player becomes dummy, all four hands are sent down, even though
    // only declarer's hand is shown to him in the UI. This is a security hole.
    //
    // <sc_deal> occurs three times for Robot Race format (table type=1),
    // second instance seemingly redundant, ~100 mS.

    if (app.deal !== undefined && app.deal.reseating) {
      console.log(
        "BBO Helper: ignoging <sc_deal> and subsequent <sc_call_made> recap " +
          "messages generated when player is reseated to be declarer."
      );
      return;
    }

    const parser = new DOMParser();
    let doc = parser.parseFromString(msg, "application/xml");

    const board = doc.getElementsByTagName("sc_deal")[0].getAttribute("board");
    const table_id = doc
      .getElementsByTagName("sc_deal")[0]
      .getAttribute("table_id");

    // The Robot Race events ('t-mbt') send a seemingly unnecessary second <sc_deal>.
    // Player is always south. Probably don't need check that other hands are not
    // provided but do it defensively.
    if (
      app.deal !== undefined &&
      app.deal.blast1_complete &&
      app.deal.board === board &&
      app.table.style === "t-mbt" &&
      msg.indexOf('west="SHDC"') !== -1 &&
      msg.indexOf('north="SHDC"') !== -1 &&
      msg.indexOf('west="SHDC"') !== -1
    ) {
      app.deal.type1DealRepeat = true;
      return;
    }

    // BBO has a bug that sometimes causes the first two boards at a Bidding or
    // Teaching table to be labeled as Board 1.
    const doubleBoard1 =
      app.deal !== undefined &&
      board === "1" &&
      (app.table.type === "100" || app.table.style === "teaching") &&
      doc.getElementsByTagName("sc_deal")[0].getAttribute("south") !==
        app.deal.south;

    if (
      app.deal === undefined ||
      app.deal.board !== board ||
      app.deal.table_id !== table_id ||
      doubleBoard1
    ) {
      if (app.deal !== undefined) {
        if (!app.deal.timingSaved) {
          // This is a last chance save. Timing should have been saved earlier
          // but this might catch a corner case in BBO not otherwise handled.
          console.warn(
            "BBO Helper: Saving board timing for previous deal " +
              "at start of new deal. It should have been saved earlier. Table " +
              "info style=%s  type=%s  tkey=%s  title=%s",
            app.table.style,
            app.table.type,
            app.table.tkey,
            app.table.title
          );
          saveDealTiming();
        }
        app.deal = undefined;
      }

      console.info("BBO Helper: board", board, "dealt at table", table_id);

      app.deal = stuffAttributes(doc.getElementsByTagName("sc_deal")[0]);
      app.deal.blast1_complete = false;
      app.deal.blast2_complete = false;
      app.deal.seenOpeningLead = false; // No opening lead yet
      app.deal.startTime = Date.now(); // seconds
      app.deal.lastActionTime = e.timeStamp; // mS
      app.deal.actionTime = [];
      app.deal.auction = [];
      app.deal.play = [];
      app.deal.amDummy = false;

      // Need this here too in case table ran out of time to complete the last hand.
      dealCleanup();

      // Sometimes we have the full deal (Bidding table, Teaching table, social table)
      // If so, launch the double dummy calculation immediately.
      if (
        pref.appDoubleDummyMode === "always" &&
        app.deal.south !== "SHDC" &&
        app.deal.west !== "SHDC" &&
        app.deal.north !== "SHDC" &&
        app.deal.east !== "SHDC"
      ) {
        const linhand = [
          app.deal.south,
          app.deal.west,
          app.deal.north,
          app.deal.east,
        ];

        let d = {
          bnum: parseInt(app.deal.board),
          hand: linboard2dotboard(linhand),
          source: "prefetch",
        };
        [d.dealer, d.vul] = bsolDealerVul(d.bnum);
        // Keep it so we don't have to regenerate it
        app.deal.d = d;

        // No callback (3rd parameter) because we don't want to show anything until
        // board is over, but rather just have the result cached.
        doubledummy(d, false);
        // loadMiddleSection(app);
      }
    } else {
      // We have become dummy and are receiving the full deal (followed by
      // an unnecessary reiteration of the auction, at least most of the time.)
      console.info("BBO Helper: player has become dummy on board", board);

      // Recieve the full deal when we become dummy (even in tournament mode!)
      app.deal.south = msg.match(/(?<= south=")[0-9TJQKACDHS]+(?=")/)[0];
      app.deal.north = msg.match(/(?<= north=")[0-9TJQKACDHS]+(?=")/)[0];
      app.deal.west = msg.match(/(?<= west=")[0-9TJQKACDHS]+(?=")/)[0];
      app.deal.east = msg.match(/(?<= east=")[0-9TJQKACDHS]+(?=")/)[0];
      app.deal.amDummy = true;
    }

    // Hide the <div> element that shows the time taken to make each call.
    const adv = document.getElementById("bhAuctionClock");
    if (adv !== null) {
      adv.hidden = true;
    }
  } else if (mtype === "sc_deal_blast_complete") {
    // This message is terminates the group of messages following the
    // preceding <sc_deal> message.

    if (app.deal.reseating) {
      return;
    }

    if (app.deal.type1DealRepeat) {
      // Don't set blast2_complete at end of redundant <sc_deal>
      console.info("redundant <sc_deal> ignored at type 1 table."); ///
      app.deal.type1DealRepeat = false;
      return;
    }
    if (!app.deal.blast1_complete) {
      app.deal.blast1_complete = true;
    } else {
      app.deal.blast2_complete = true;
    }
  } else if (mtype === "sc_dummy_holds") {
    // <sc_dummy_holds table_id="3024185" board="1" dummy="S456HQAD478TC679Q" />
  } else if (mtype === "sc_claim_accepted") {
    // Claim accepted
    const nclaimed = parseInt(msg.match(/(?<= tricks=")\d+(?=")/)[0]);
    console.info(
      "BBO Helper: Saving board timing (claim of %s tricks accepted).",
      nclaimed
    );
    saveDealTiming();

    if (app.table.style === "teaching") {
      // Other means of populating APP.PLAY do not occur at a Teaching table.
      saveDealPlay(nclaimed);

      // Need to explicitly kick off double dummy display because Teaching tables
      // don't generate a mh_hand PHP request. The double dummy results is usually
      // already cached because <sc_deal> message has the full hand at Teaching tables.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
    }
  } else if (mtype === "sc_context") {
    // The exact circumstances that trigger this message are unclear. Seems to
    // involve state changes. In a tournament context it occurs immediately
    // after a deal is completed in order to start the next deal but does not
    // occur if time runs out during board is not. At a Teaching Table it does
    // not occur until the table host request the next deal (Redeal from menu)
    // This message occurs when all seats are filled (allowing first deal) at
    // a Teaching Table but does not occur before first deal of a tournament.
    // Message does not occur at Bidding Tables (cs_make_bid message have a
    // context_id but it does not change between boards)
    //
    // BBO Helper 1.2 and earlier keyed off this event.
  } else if (mtype === "cs_get_board") {
    // This is issued when a board is selected in the History Pane of the
    // current session (including results from other tables) or when a board
    // from the current table completes IF the History Pane is open and showing
    // boards for the current session. (So for example, cs_get_board is NOT
    // issued after board 135 in the log "BBO Traffic 2021-11-09 17.54.48 -
    // 18.27.00 - Kibitzing (SaveTiming Testing).htm"
  } else if (mtype === "sc_board_details") {
    // Issued in response to a <cs_get_board> message. Get one for all boards
    // requested in the current session (whether playing or kibitzing). This
    // includes requests for play at other tables for boards in current session.

    // Note: historyDDsession() also populates app.play.
    historyDDsession(msg);
  } else if (mtype === "sc_table_node") {
    // Creation of table. Will contain a single <sc_table_open> element.
    //
    // Note: Robot Race events (style = 't-mbt') send a second <sc_table_node>
    // when the human becomes declarer (same table_id) with human reseated in North
    // seat and the robot partner seated in the South seat. This is preceded by an
    // <sc_notify_user message="Switching seats so that player can declare"
    // priority="1" /> message for the BBO UI and followed by an <sc_deal> and a
    // reiteration of the auction (all <sc_call_made>), <sc_dummy_holds>, then
    // <sc_table_open_complete>. Then final pass call arrives.

    const parser = new DOMParser();
    let doc = parser.parseFromString(msg, "application/xml");

    // style='teaching', 't-pairs', 't-indy' (e.g. Human Declarers Robot event),
    // 'vugraph', 't-mbt' (Robot Race), 'sb' (Solitaire, Challenges), '' (Social)
    //
    // See also type="#". Not clear exactly when where different table types occur
    // 1 --> Robot Race
    // 4 --> Teaching / Vugraph
    // 7 --> (Pairs only?) ACBL? Tournament, Robot Rebate 55%, Solitaire
    // 8 --> Social / Speedball / Human Declares (Robot), Challenges
    // 100 --> Bidding
    //
    // https://www.bridgebase.com/help/v2help/robots_tournaments.html
    // https://www.bridgebase.com/help/v2help/robots_solitaire.html

    const sc_table = doc.getElementsByTagName("sc_table_open")[0];
    const style = sc_table.getAttribute("style");

    // Last condition is paranoid: avoid table gettting stuck in app.deal.reseating TRUE
    // in possible weird boundary cases, never yet actually seen.
    if (app.deal !== undefined && app.deal.reseating && style === "t-indy") {
      return;
    }

    app.table = stuffAttributes(sc_table);
    app.table.players = ["", "", "", ""];
    app.table.myseatix = undefined;
    if (app.context_id !== app.table.context_id) {
      // New deal.
      app.context_id = app.table.context_id;
      app.deal = undefined;
    }

    const tkey = app.table.tkey;
    if (
      app.tourney !== undefined &&
      app.tourney[tkey] !== undefined &&
      !app.tourney[tkey].started
    ) {
      app.tourney[tkey].started = true;
      console.info("BBO Helper: Tournament", app.tourney[tkey], "is starting.");
      // Could compute field strength now.
    }

    console.info(
      "BBO Helper: Table %s  type=%s  style=%s  host=%s  (%s)",
      app.table.table_id,
      app.table.type,
      app.table.style,
      app.table.h,
      app.table.title
    );
  } else if (mtype === "sc_table_open_complete") {
    // If we've been ignoring <sc_call_made> and other messages involved in
    // reseating the player to declare the contract (Human Declares, Robot Duplicate,
    // Robot Rebate 55%, etc), resume processing.
    if (app.deal !== undefined) {
      app.deal.reseating = false;
    }
  } else if (mtype === "sc_player_sit") {
    // One message for each seat arrives after each <sc_deal> messages, and
    // then again after the play begins (in case a player is partnered with
    // a robot in a Human Declares tournament, becomes dummy, and is reseated
    // as declarer). Also get these messages mid-hand if a player leaves and
    // is replaced.

    const parser = new DOMParser();
    const doc = parser.parseFromString(msg, "application/xml").children[0];
    const seat = doc.getAttribute("seat");
    const username = doc.getAttribute("username");

    const ix =
      seat === "south" ? 0 : seat === "west" ? 1 : seat === "north" ? 2 : 3;

    // Check if declarer is being reseated in a Human Declares, Robot Duplicate,
    // or Robot Rebate 55% robot event.
    const ncalls = app.deal !== undefined ? app.deal.auction.length : undefined;
    const reseatedDeclarer =
      app.deal !== undefined &&
      app.deal.notificationReceived &&
      seat === "north" &&
      username === app.user &&
      app.table.style === "t-indy" &&
      app.table.tkey !== undefined &&
      app.table.tkey.endsWith("bbombadmin") &&
      app.deal.auction[ncalls - 1] === "p" &&
      app.deal.auction[ncalls - 2] === "p";

    if (reseatedDeclarer) {
      // Undo the reseating because we want to keep player in the South seat for
      // various keying purposes, including time saving.
      console.info("BBO Helper: Undoing reseating in app.table.players[]");
      app.table.players[0] = username;
      // Should never be undefined (but be paranoid);
      app.table.players[2] =
        app.deal.robotNorth === undefined ? "" : app.deal.robotNorth;
    } else if (app.table.style === "vugraph") {
      // 'username' attribute normally matches 'label' attribute but during a VuGraph
      // presentation 'username' is the BBO handle of the VuGraph presenter for all
      // four seats and label is player's name (they might not even have a BBO account).
      const name = doc.getAttribute("label");
      app.table.players[ix] = name;

      // Try to look up player's full name if we haven't tried already.
      if (!vgnames.hasOwnProperty(name)) {
        vugraphNameLookup(name);
      }
    } else {
      // Most typical case.
      app.table.players[ix] = username;

      if (app.table.players[ix] === app.user) {
        app.table.myseatix = ix;
      }

      if (!realnames.hasOwnProperty(username.toLowerCase())) {
        browser.runtime
          .sendMessage({ type: "lookup", bbohandle: username })
          .then(realnameResponse);
      }
    }

    // The BBO handles shown in the History Pane are the players seated at
    // the end of the hand. The one exception might be Human Declares robot
    // events. Don't know if BBO re-reseats the player at the end of the hand.
    // Note: Conditional fails faster by checking seats in East, North, West,
    // South order since East BBO handle is usually (probably always) pushed
    // down last.
    const players = app.table.players;
    if (
      players[3] !== undefined &&
      players[2] !== undefined &&
      players[1] !== undefined &&
      players[0] !== undefined &&
      app.deal !== undefined &&
      app.deal.board !== undefined
    ) {
      app.deal.dealkey = app.deal.board + "+" + players.join("+");
    }
  } else if (mtype === "sc_player_stand") {
    const parser = new DOMParser();
    let doc = parser.parseFromString(msg, "application/xml").children[0];
    let seat = doc.getAttribute("seat");

    if (
      seat === "north" &&
      app.table.style === "t-indy" &&
      app.table.players[2].startsWith("~~")
    ) {
      // Robot player might be standing so that human player can declarer
      // in Human Declares format. Save robot handle.
      app.deal.robotNorth = app.table.players[2];
    }

    let ix =
      seat === "south" ? 0 : seat === "west" ? 1 : seat === "north" ? 2 : 3;
    app.table.players[ix] = "";

    if (app.table.players[ix] === app.user) {
      app.table.myseatix = undefined;
    }
  } else if (mtype === "sc_vote_accepted") {
    if (msg.search('type="claim"') !== -1) {
      dealCleanup();
    }
  } else if (mtype === "sc_vote_rejected") {
    // Time that opponents spend evaluating a claim or rejecting an undo does not
    // count against time required for player to play a card.
    if (msg.search('type="claim"') !== -1 || msg.search('type="undo"') !== -1) {
      app.deal.lastActionTime = e.timeStamp;
    }
  } else if (mtype === "sc_table_close") {
    // Normally this means you have left a table, either voluntarily, because a round
    // ended in a tournament, or the host booted you. However it also occurs when you
    // are reseated to declare the hand even though you aren't really "leaving".

    if (app.deal !== undefined) {
      // First check if this a reseating of the player in the North seat to declare
      // in a Human Declarers robot event. This is a paranoid level of checking based
      // on imperfect knowledge of how BBO handles every event format while at the
      // same time seeking to avoid language localization issue with <sc_notify_user>
      // messages. Note: only check for two passes at the end of the auction. The
      // reseating related messages occur before final pass arrives.
      const ncalls =
        app.deal !== undefined ? app.deal.auction.length : undefined;
      const reseatingDeclarer =
        app.deal.notificationReceived &&
        app.table.style === "t-indy" &&
        app.table.tkey !== undefined &&
        app.table.tkey.endsWith("bbombadmin") &&
        app.deal.auction[ncalls - 1] === "p" &&
        app.deal.auction[ncalls - 2] === "p";

      if (reseatingDeclarer) {
        console.info("BBO Helper: Player is being reseated to be declarer.");
        // Set flag so we ignore some messages until <sc_table_open_complete>
        app.deal.reseating = true;
        return;
      }
    }

    if (app.deal !== undefined && !app.deal.timingSaved) {
      if (app.table.tkey) {
        const consoleMsg =
          "BBO Helper: Saving board timing (looks like time ran " +
          "out on round of tournament " +
          app.table.tkey +
          ")";
        console.info(consoleMsg);
      } else {
        console.info("BBO Helper: Saving board timing (table closed)");
      }
      saveDealTiming();
    }

    app.deal = undefined;
  } else if (mtype === "sc_notify_user") {
    // Message examples:
    //
    // "Switching seats so that player can declare"  (Human Declares format)
    // "Director ACBL_65 has been requested by [bbohandle]"
    // "Director ACBL_51 is now at the table as requested by [bbohandle]"
    // "Director has adjusted Board 9 to 3NE-2 at table 23"
    // "The remainder of this round has been skipped, and Averages assigned."
    // "Cannot chat to player. Permission denied."
    // "Invitations have been issued"
    //
    // These are localized, so code relying on the message content needs to
    // grab the localized version when the lang.php message comes down shortly
    // after the user logs in, e.g. <m i="F1314" d="Switching seats so that
    // player can declare"/>. But can the F1314 style code be counted on long term?

    // For now gust flag that any notification has occured since deal started to
    // help test for declarer being reseated in a Human Declares scenario.
    if (app.deal !== undefined) {
      app.deal.notificationReceived = true;
    }
  } else if (mtype === "sc_user_details") {
    const parser = new DOMParser();
    let doc = parser.parseFromString(msg, "application/xml");
    let userprof = doc.getElementsByTagName("sc_user_profile")[0];
    if (userprof === undefined) {
      return;
    } // guard, shouldn't happen

    let bbohandle = userprof.getAttribute("username").toLowerCase();
    bboprofiles[bbohandle] = stuffAttributes(userprof);
    let bboname = bboprofiles[bbohandle]["name"];

    // Clean up spurious whitespace and ignore non real name of 'private'.
    bboprofiles[bbohandle]["name"] =
      bboname.toLowerCase() === "private" ? "" : bboname.trim();

    if (!realnames.hasOwnProperty(bbohandle)) {
      browser.runtime
        .sendMessage({ type: "lookup", bbohandle: bbohandle })
        .then(realnameResponse);
    }
  } else if (mtype === "sc_t_register") {
    // Other teams (i.e. pairs, teams, or individuals) registered in the event.
    // When client sends up cs_t_subscribe request, all currently registered
    // teams are sent down one at a time. Then new registrations trickle in
    // until the tournament starts.
    const parser = new DOMParser();
    const doc = parser.parseFromString(msg, "application/xml");
    const el = doc.getElementsByTagName("sc_t_register")[0];
    const tkey = el.getAttribute("tkey");
    if (app.tourney[tkey] !== undefined) {
      // Should always be defined from a prior cs_t_subscribe request.
      let teamid = el.getAttribute("teamid");
      let teamname = el.getAttribute("teamname");
      app.tourney[tkey].teams[teamid] = { teamname: teamname };
    }
  } else if (mtype === "sc_t_pd_register") {
    // What is this? They are individuals and pay="none" or pay="self"
    // Are they fill-ins?
  } else if (mtype === "cs_t_subscribe") {
    const tkey = msg.match(/(?<=\x01tkey=)[^\x01]*(?=\x01)/)[0];
    app.tourney[tkey] = { teams: {}, started: false };
  } else if (mtype === "sc_tourney_details") {
    const tkey = msg.match(/(?<= tkey=")[^"]*(?=")/);
    if (tkey !== null && app.tourney[tkey] !== undefined) {
      const parser = new DOMParser();
      let doc = parser.parseFromString(msg, "application/xml");
      // Useful host="ACBL", undo="n" org="acbl"
      // title="#14873 Pairs ACBL Tue 11PM (MP) Speedball"
      app.tourney[tkey].details = stuffAttributes(
        doc.getElementsByTagName("sc_tourney_details")[0]
      );
    }
  } else if (mtype === "sc_tourney_blast_complete") {
    // Note: Registrations can continue to roll in
  } else if (mtype === "sc_t_reg") {
    // Registration confirmation. Example:
    // <sc_t_reg tkey="14873~ACBL" partner="kb2553" />
  } else if (mtype === "sc_undo") {
    undo(msg, e.timeStamp);
  } else if (mtype === "sc_loginok") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(msg, "application/xml");
    const el = doc.getElementsByTagName("sc_loginok")[0];
    app.user = el.getAttribute("user");

    // This is the "session password" which is passed to certain BBO APIs.
    app.usersp = el.getAttribute("sp");
    app.deal = undefined;

    rightPaneWatcher();
  } else if (mtype === "cs_logout") {
    sessionCleanup();
  }

  // Player is booted off by the server, typically for idling too long (preceded
  // by cs_prompt_response message, noting idle client behavior) or when logging
  // in from a different location.
  else if (mtype === "sc_boot") {
    sessionCleanup();
  }
}

function sessionCleanup() {
  const dv = document.getElementById("bh-board-copy-aid");
  if (dv !== null) {
    dv.remove();
  }
  if (app.deal !== undefined) {
    saveDealTiming();
  }
}

async function rightPaneWatcher() {
  // Adds a mutation observer to pane on the right side of the BBO application.
  // that waits for elements with the userListClass to be added when the user
  // first selects the People tab.

  // The rightDiv is always present even when it is hidden by clicking on the
  // currently open tab (e.g. Messages when the BBO application is started).
  // It contains the <main-tab-bar> (Message, People, etc vertical tabs),
  // <video_chat_container>, and a <div> that holds the <screen> elements
  // that contain the panes for Messages, History, etc.
  const rightDiv = document.getElementById("rightDiv");
  if (rightDiv === null) {
    return;
  } // Guard against changes.

  const mainDiv = rightDiv.getElementsByClassName("mainDivClass")[0];
  if (mainDiv === undefined) {
    return;
  }

  let WOSfound = false;

  const obsPane = new MutationObserver(newScreenElement);

  // Watch for addition/removal of children until People tab is selected.
  obsPane.observe(mainDiv, { childList: true });

  function newScreenElement(mutations) {
    for (let mr of mutations) {
      for (let el of mr.addedNodes) {
        // Guard. Should only be adding <screen> elements
        if (el.tagName !== "SCREEN") {
          continue;
        }

        // We don't know which screen has been added. It's unsafe to rely
        // on innerText of descendant elements, due to internationalization.
        // If it is the People screen, the subtree is not built yet, so
        // wait a little bit and see if <who-online-screen> descendant
        // appears.
        if (!WOSfound) {
          WOSfinder(el);
        }
      }
    }
  }

  async function WOSfinder(el) {
    // If this is the People screen, <whos-online-screen> will appear shortly.
    // Watch for it briefly.

    const obsWOS = new MutationObserver(screenChildElement);

    // Watch for addition/removal of children until People tab is selected.
    obsWOS.observe(el, { childList: true, subtree: true });

    setTimeout(() => {
      obsWOS.disconnect();
    }, 5000); // Try for 5 sec
  }

  function screenChildElement(mutations) {
    let wos;

    // console.info(mutations.length, 'mutation records reported');
    for (let mr of mutations) {
      for (let el of mr.addedNodes) {
        // Custom HTML element that holds Friends, Host, and Stars under
        // People tab of the right Pane.
        if (el.tagName === "WHOS-ONLINE-SCREEN") {
          wos = el;
          break;
        }
      }
    }

    if (!wos) {
      return;
    }

    WOSfound = true;
    console.info("BBO Helper: <whos-online-screen> found in People screen.");

    // Watch for addition/removal of elements on the 'userListClass subtree.
    // Switching to more specific MutationObserver to lower observation overhead.
    const obsUserList = new MutationObserver(newUserListElement);
    const config = { subtree: true, childList: true };
    obsUserList.observe(wos, config);
  }

  function newUserListElement(mutations) {
    let currentBBOhandle, currNameTag;

    let params = { capture: true, passive: true };
    for (let mr of mutations) {
      for (let el of mr.addedNodes) {
        if (el.tagName !== "USER-LIST-ITEM") {
          continue;
        }

        // An item (BBO handle) has been added to the Friends, Host, or Stars
        // list under the People tab of the right Pane. It contains a <div>
        // that contains elements for the player's image, name tag, and status.
        let ntag = el.getElementsByTagName("NAME-TAG")[0];

        // Bail if no name tag (shouldn't happen).
        if (ntag === undefined) {
          continue;
        }

        let button = ntag.getElementsByClassName("mat-button-wrapper")[0];
        if (button === undefined) {
          console.error("BBO Helper: missing mat-button-wrapper");
        } else {
          let bbohandle = button.innerText.trim().toLowerCase();

          // Look up real names as soon as we see handles unless the
          // BBO handle has not yet been inserted into the button.
          if (bbohandle !== "" && !realnames.hasOwnProperty(bbohandle)) {
            browser.runtime
              .sendMessage({ type: "lookup", bbohandle: bbohandle })
              .then(realnameResponse);
          }
        }

        // Add 'mouseenter' and 'mouseleave' event handlers. This is much more
        // efficient listening for 'mouseover' and 'mouseout' because those
        // generate many more events.
        ntag.addEventListener("mouseenter", nameMouseEnter, params);
        ntag.addEventListener("mouseleave", nameMouseLeave, params);
      }
    }

    function nameMouseEnter() {
      // Use THIS rather than EVENT.TARGET. THIS refers to the element capturing
      // the event, i.e. the <name-tag> element here. EVENT.TARGET is the element
      // the deepest nested element the mouse entered within <name-tag>, e.g. it
      // might be the <img> element to the right of a player's handle that shows
      // the player's BBO rank.
      currentBBOhandle = undefined;
      let button = this.getElementsByClassName("mat-button-wrapper")[0];

      // The button has the BBO handle. It should always exist but guard anyhow.
      if (button === undefined) {
        return;
      }

      // The innerText has a space on either side, a poor formatting technique.
      // BBO should handle it via CSS instead.
      let bbohandle = button.innerText.trim().toLowerCase();

      // Shouldn't have unpopulated BBO handle. But bail if so.
      if (bbohandle === "") {
        return;
      }

      currNameTag = this;
      currentBBOhandle = bbohandle;
      // console.info('mouseenter', bbohandle);

      showNameTooltip(bbohandle);

      if (!realnames.hasOwnProperty(bbohandle)) {
        // Try to player information from the background service if we have not
        // already tried, and then display it when we have a response.
        browser.runtime
          .sendMessage({ type: "lookup", bbohandle: bbohandle })
          .then(realnameResponseTooltip);
      }
    }

    function nameMouseLeave() {
      // console.info('mouseleave');
      currNameTag = undefined;
      currentBBOhandle = undefined;

      const dv = document.getElementById("bh-realname-tooltip");
      if (dv !== null) {
        dv.style.display = "none";
      }
    }

    function realnameResponseTooltip(msg) {
      realnameResponse(msg); // Log response from background service.

      // Bail if mouse has been moved away since name lookup was issued.
      if (msg.bbohandle !== currentBBOhandle) {
        return;
      }

      if (msg.lookupfail) {
        const dv = document.getElementById("bh-realname-tooltip");
        if (dv !== null) {
          dv.style.display = "none";
        }
      } else {
        showNameTooltip(msg.bbohandle);
      }
    }

    function showNameTooltip(bbohandle) {
      if (!pref.appShowPeopleTooltip) {
        return;
      }

      // Try to use real name, but fall back to name in BBO profile.
      let fullname =
        realnames[bbohandle] !== undefined
          ? realnames[bbohandle].fullname
          : bboprofiles[bbohandle] !== undefined
          ? bboprofiles[bbohandle].name
          : undefined;

      if (!fullname) {
        return;
      }

      let dv = document.getElementById("bh-realname-tooltip");
      if (dv === null) {
        dv = document.createElement("div");
        dv.id = "bh-realname-tooltip";

        dv.style =
          "position: absolute; padding: 0.2em 0.5em 0.2em 0.5em; " +
          "border-radius: 7px; background: #f0f0f0; color: blue; " +
          "border: 1px solid blue; font-size: 125%; font-family: sans-serif";

        dv.innerText = fullname;
      } else {
        dv.innerText = fullname;
        dv.style.display = "block";
      }

      if (!currNameTag) {
        return;
      } // Shouldn't happen (guard);

      dv.style.left = parseInt(currNameTag.offsetWidth * 1.03) + "px";
      dv.style.top = "0px";

      // Need to attach to the parent <div> (of class nonProfileImageDivClass)
      currNameTag.parentElement.appendChild(dv);
    }
  }
}

function dealCleanup() {
  // Remove timing for last trick.
  const felt = elPlayingFelt();
  if (!felt) {
    return;
  }

  const dv = felt.getElementsByClassName("bhPlayClock");

  for (let i = 0; i < dv.length; i++) {
    dv[i].hidden = true;
  }
}

function undo(msg, timeStamp) {
  // An Undo has been accepted. The undo is offered as a vote
  // <sc_vote_request type="undo" ...> and if accepted by the opponent(s),
  // the <sc_undo> is issued.
  //
  // Message looks like: <sc_undo table_id="1782368" position="e" count="1"
  // partialmovie="mb|1C|mb|1D|mb|d|mb|1H|mb|p|mb|1S|mb|2C|mb|p|mb|p|mb|p|pc|SK|"/>
  //
  // where 'count' and 'partialmovie' fields may have been added sometime after
  // July 2021. 'partialmovie' is the state of the deal after (or before? )the
  // rollback. For position="*" count="0" scenario it definitely seems like case
  // before rollback.

  const undoCountMatch = msg.match(/(?<= count=")\d+(?=")/);
  const positionMatch = msg.match(/(?<= position=")\W+(?=")/);

  // Undo seat of * only occurs commonly in Vugraph presentations but have also
  // been seen at Teaching tables, seemingly also with count="0". See board 10 in
  // "Traffic/BBO Traffic 2021-11-19 19.23.43 - 20.13.59 - Vugraph Until Table
  // Closed.htm". These are issued by the presenter and there is no vote (vote="n")
  // though the undo is still preceded by <sc_vote_request> and <sc_vote_accepted>
  // messages.

  if (undoCountMatch === null) {
    console.error("BBO Helper: Unable to parse count from <sc_undo>:", msg);
    return;
  }

  let undoCount = parseInt(undoCountMatch[0]);
  const position = positionMatch !== null ? positionMatch[0] : undefined;

  console.info("BBO Helper: undo %d actions, position=%s", undoCount, position);

  // Case of count="0" position="*" is confusing. Still looks like one action must
  // be rolled back. Perhaps "*" means next seat has not acted yet.
  if (undoCount === 0 && position === "*") {
    undoCount = 1;
  }

  // Guard against a rollback past start of deal. Should never happen.
  if (undoCount > app.deal.actionTime.length) {
    console.error(
      "BBO Helper: Undo to before start of deal, count:",
      undoCount,
      "actionTime length:",
      app.deal.actionTime.length
    );
    return;
  }

  // Start clock for the next action at the time of the undo.
  app.deal.lastActionTime = timeStamp;

  // Rewind the timing array.
  app.deal.actionTime.length = app.deal.actionTime.length - undoCount;

  // Rewind the play array and then the auction array if necessary.
  // Note: undos can rewind from the play back to the auction.
  if (app.deal.play.length >= undoCount) {
    app.deal.play.length = app.deal.play.length - undoCount;
  } else {
    // Still in the auction or rolled back into it.
    app.deal.seenOpeningLead = false;

    let undoAuctionCount = undoCount - app.deal.play.length;
    app.deal.play.length = 0;
    app.deal.auction.length = app.deal.auction.length - undoAuctionCount;
    app.deal.amDummy = false;
  }

  // Rewind app.trick and app.deals.tricks[] if necessary.
  if (app.deal.seenOpeningLead) {
    let cnt = undoCount;
    while (cnt > 0) {
      let ncards = app.trick.cards.length;
      if (ncards >= cnt) {
        app.trick.cards.length = ncards - cnt;
        cnt = 0;
      } else {
        cnt -= ncards;
        app.trick = app.deal.tricks.pop();
        // Bail if we have rolled back into the auction.
        if (app.trick === undefined) {
          break;
        }
      }
    }
  }

  // Should deal with on screen timing data too but can do it later.
  // It will get cleaned on the next trick anyhow.
}

async function saveCardSize() {
  // Invoked once during the auction. Figure out how big the playing cards are
  // before some are played off. This is kind of hacky but we don't have internal
  // state of the BBO app.

  // If user has not played or kibitzed a hand until now, the playing felt may
  // not yet be created.
  const maxTries = 11,
    sleepTime = 200; // mS
  for (let itry = 0; itry < maxTries; itry++) {
    if (itry) {
      await sleep(sleepTime);
    }

    let felt = elPlayingFelt();
    if (!felt) {
      continue;
    }

    let cd = felt.getElementsByClassName("cardClass");

    let cardHeight, cardWidth;
    for (let i = 0; i < cd.length; i++) {
      // 108 cards (52 x 2 + 4 for current trick?). About half have offsetWidth
      // and offsetHeight set to zero. Here we find the size of a card displayed
      // for tricks. The card size in player's hands is smaller.
      if (cd[i].offsetWidth && cd[i].offsetHeight) {
        cardHeight = cd[i].offsetHeight;
        cardWidth = cd[i].offsetWidth;
        break; // size is the same for all non-zero sized cards.
      }
    }

    if (!cardHeight) {
      continue;
    }

    app.cardHeight = cardHeight;
    app.cardWidth = cardWidth;
    return;
  }

  maxWait = (((maxTries - 1) * sleepTime) / 1000).toFixed(0);
  console.info(
    "BBO Helper: saveCardSize(): Gave up waiting for UI to render after %s " +
      "sec. Using default of 102 x 148 px for card size.",
    maxWait
  );
  app.cardHeight = 148;
  app.cardWidth = 102;
}

function trickcard(card, timeStamp, isMe) {
  // Process playing of a card.

  const rankorder = "23456789TJQKA";
  const seats = ["South", "West", "North", "East"]; // BBO order

  // If we get getting <sc_card_played> messages and the deal blast is not
  // complete, we have arrived at the table after the play started and
  // are receiving catch-up messages. Assign these a TDIFF of 0 because we
  // have no timing information.
  let tdiff = app.deal.blast1_complete
    ? timeStamp - app.deal.lastActionTime
    : 0;

  app.deal.play.push(card);
  app.deal.actionTime.push(tdiff);
  app.deal.lastActionTime = timeStamp;

  if (!app.deal.seenOpeningLead) {
    // Figure out declarer and the denomination from the auction so
    // that we can figure out who is playing each card even when we
    // don't have the full deal because we are playing.
    auctionContract();
    app.deal.seenOpeningLead = true;
    app.deal.tricks = [];
    app.trick = { leader: (app.deal.declarer + 1) % 4, cards: [] };

    console.info(
      "Contract is %c%s by %s",
      "color: magenta",
      app.deal.contract,
      seats[app.deal.declarer]
    );
  }

  let seatix = (app.trick.leader + app.trick.cards.length) % 4;
  let seat = seats[seatix];
  let suit = card.charAt(0);
  let sym = suit === "S" ? "♠" : suit === "H" ? "♥" : suit === "D" ? "♦" : "♣";
  let symcard = sym + card.charAt(1);

  console.info(
    card,
    "(" + symcard + ")",
    "played by",
    seat + (isMe ? " (you)" : ""),
    "after",
    (tdiff / 1000).toFixed(3),
    tdiff ? "sec" : "sec (joining table part way through hand)"
  );

  app.trick.cards.push(card);

  if (app.trick.cards.length === 4) {
    app.deal.tricks.push(app.trick);

    // Previous trick is complete. Figure out who won it.
    let bix = 0; // index of best card
    let trump = app.deal.denom;
    let bestDenom = app.trick.cards[0].charAt(0);
    let bestRank = rankorder.indexOf(app.trick.cards[0].charAt(1));
    for (let i = 1; i < 4; i++) {
      let denom = app.trick.cards[i].charAt(0);
      let rank = rankorder.indexOf(app.trick.cards[i].charAt(1));
      if (denom === bestDenom) {
        if (rank > bestRank) {
          bestRank = rank;
          bix = i;
        }
      } else if (denom === trump) {
        bestDenom = trump;
        bestRank = rank;
        bix = i;
      }
    }
    let lix = (app.trick.leader + bix) % 4;

    // Don't want console to maintain a reference to APP.TRICKS.CARDS. Could
    // be a slow memory leak. So reduce to string output.
    console.info(
      "%s won the trick [ %c%s, %s, %s, %s",
      seats[lix],
      "color: magenta",
      app.trick.cards[0],
      app.trick.cards[1],
      app.trick.cards[2],
      app.trick.cards[3],
      "]"
    );

    app.trick = { leader: lix, cards: [] };
  }

  // Display timing info (if requested), hide it if setting has changed, etc.
  playclock(seatix, tdiff);

  if (app.deal.play.length === 52) {
    // Show the time required to play the last card briefly. Then cleanup.
    setTimeout(() => {
      dealCleanup();
    }, 1500);

    console.info("BBO Helper: Saving board timing (all 52 cards played).");
    saveDealTiming();

    if (app.table.style === "teaching") {
      // Other means of populating APP.PLAY do not occur at a Teaching table.
      saveDealPlay();

      // Need to explicitly kick off double dummy display because Teaching tables
      // don't generate a mh_hand PHP request. The double dummy results is usually
      // already cached because <sc_deal> message has the full hand at Teaching tables.
      app.deal.d.source = "session"; // update from 'prefetch'
      const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(app.deal.d, bCacheOnly, historyDDcallback);
    }
  }
}

function stuffAttributes(el) {
  // Stuffs all the attributes of a DOM object into an object. Mostly used
  // for storing components of server to client BBO application XML.
  let ob = {};
  let attr = el.getAttributeNames();
  for (let j = 0; j < attr.length; j++) {
    ob[attr[j]] = el.getAttribute(attr[j]);
  }
  return ob;
}

async function vugraphNameLookup(name) {
  // Tries to find the full name of a player on a Vugraph presentation via
  // the BBO webutil API (same one used by BBO when you click on a Vugraph player)

  // Regardless of what happens, flag that we tried so we don't keep trying.
  vgnames[name] = undefined;

  // Get around a CORS issue by making the web request in the service worker,
  // but parse ther result in the callback below because the service worker
  // does not have access to the DOM, include DOMParser().
  const msg = { type: "vugraph_name", vgPresenter: app.table.h, name: name };
  browser.runtime.sendMessage(msg).then(vugraphResponse);

  function vugraphResponse(html) {
    /// console.info('BBO Helper vugraph lookup response', html);
    if (html === undefined || html === "") {
      console.warn("BBO Helper: Vugraph name lookup failed.");
      return;
    }

    const parser = new DOMParser();
    let doc;

    try {
      doc = parser.parseFromString(html, "text/html");
    } catch (ec) {
      console.warn("Failed to parse VuGraph player HTML:", html, "error:", ec);
      return;
    }

    // VuGraph player information seems to be pulled from multiple sources,
    // all unrelated to BBO. Do not know all cases so we will not always succeed.
    if (doc.title === "Player details") {
      const bolded = doc.getElementsByTagName("b");
      if (bolded.length === 0) {
        return;
      }
      let fullname = bolded[0].innerText.trim();
      if (fullname === "") {
        return;
      }
      if (fullname.match(/[a-z]/) === null) {
        // Clean up an all uppercase name.
        fullname = fullname.toLowerCase();
        let parts = fullname.split(/\s+/);
        for (let i = 0; i < parts.length; i++) {
          parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substring(1);
        }
        fullname = parts.join(" ");
      }

      vgnames[name] = fullname;
    }
  }
}

function elPlayingFelt() {
  // Returns the green "felt" area of the play window.

  let dsc = document.getElementsByClassName("dealScreenDivClass");
  if (dsc.length === 0) {
    return;
  } // not playing or kibitzing.

  // This is the just the card playing area, the "green felt"
  return dsc[0].getElementsByClassName("coverClass")[0];
}

function whatHistoryScreen() {
  // Determine if user is viewing the History screen and if so whether it
  // is the hand history for the current session ('session') or for a
  // previous session ('review'). Returns 'session', 'review', or undefined
  // (if History pane is not visible). Note: returns 'session' when looking
  // at list of tournaments before selecting one.

  let rd = document.getElementById("rightDiv");
  if (rd === null) {
    return;
  }

  // The Angular elements below #rightDiv are <screen> (various tabs).
  let screens = rd.getElementsByTagName("screen");
  for (let i = 0; i < screens.length; i++) {
    if (screens[i].style.display === "none") {
      continue;
    }

    // Currently displayed screen
    let hs = screens[i].getElementsByTagName("history-screen")[0];
    if (hs !== undefined) {
      return "session";
    }

    let rs = screens[i].getElementsByTagName("result-list-screen")[0];
    if (rs !== undefined) {
      return "review";
    }
  }
}

function elDealViewer(mode) {
  // Find a <deal-viewer> element in the History pane on the right side of
  // the BBO application. There are two possible deal viewers in the History
  // pane, depending on whether they have been added to the DOM.
  //
  // el = elDealViewer('session');  // Deal viewer for current session
  // el = elDealViewer('review');   // Deal viewer for review
  // ob = elDealViewer('visible');  // Visible deal viewer
  //
  // For last case ob.dealViewer is the <deal-viewer> element and ob.mode
  // is 'session' or 'review', depending on what is visible.

  let rd = document.getElementById("rightDiv");
  if (rd === null) {
    return;
  }

  // The Angular elements beloew #rightDiv are <screen> (various tabs) then
  // <history-screen> / <result-list-screen>, then <result-list>, then
  // <deal-review-screen>, then <deal-viewer>. <history-screen> is for the
  // current session (playing or kibitzing, My table or Recent hands) and
  // <results-list-screen> is for reviewing past sessions. <history-screen>
  // is created when the user first selects the History tab even if the user
  // is not playing or kibitzing. <result-list-screen> isn't created until
  // the player looks at results of past session (Recent tournaments) and
  // it is sometimes destroyed. Other tables is associated with <screen>
  // element that it is being applied to.

  if (mode === "review") {
    // Find it regardless of visibility.
    let rs = rd.getElementsByTagName("result-list-screen")[0];
    if (rs === undefined) {
      return;
    }
    return rs.getElementsByTagName("deal-viewer")[0];
  } else if (mode === "session") {
    // Find it regardless of visibility.
    let hs = rd.getElementsByTagName("history-screen")[0];
    if (hs === undefined) {
      return;
    }
    return hs.getElementsByTagName("deal-viewer")[0];
  } else if (mode === "visible") {
    let screens = rd.getElementsByTagName("screen");
    for (let i = 0; i < screens.length; i++) {
      if (screens[i].style.display === "none") {
        continue;
      }

      let hs = screens[i].getElementsByTagName("history-screen")[0];
      if (hs !== undefined) {
        return {
          dealViewer: hs.getElementsByTagName("deal-viewer")[0],
          mode: "session",
        };
      }
      let rs = screens[i].getElementsByTagName("result-list-screen")[0];
      if (rs !== undefined) {
        return {
          dealViewer: rs.getElementsByTagName("deal-viewer")[0],
          mode: "review",
        };
      }

      // Probably not in History pane (could be Messages, People, Account, Tables, etc)
      return;
    }
  } else {
    console.error("BBO Helper: elDealViewer(): unsupported mode:", mode);
  }
}

function historyDDsession(msg) {
  // Handles boards requested for the current session, whether playing or kibitzing,
  // at both the current table and for other tables that have played the boards.
  // Parse hands out of <sc_board_details> message and query John Goacher's BSOL.
  // Also populate APP.CARDPLAY.

  const seats = ["south", "west", "north", "east"]; // BBO order

  // Parse <sc_board_details> message
  const parser = new DOMParser();
  let doc = parser.parseFromString(msg, "application/xml");

  let sd = doc.getElementsByTagName("sc_deal")[0];

  let linhand = new Array(4);
  for (let i = 0; i < 4; i++) {
    linhand[i] = sd.getAttribute(seats[i]);
  }
  let hand = linboard2dotboard(linhand);

  let d = {
    bnum: parseInt(sd.getAttribute("board")),
    hand: hand,
    contract: "",
    source: "session",
  };

  // Key for saving alerts and card play
  const key =
    hand.join("+") + "-" + sd.getAttribute("labelsouth").toLowerCase();
  console.info("BBO Helper historyDDsession() cardplay key", key);

  // Populate APP.ALERT
  let alert = [];
  const scm = doc.getElementsByTagName("sc_call_made");
  for (let i = 0; i < scm.length; i++) {
    let al = scm[i].getAttribute("explain").trim();
    if (al === "" && scm[i].getAttribute("alert") === "N") {
      al = undefined;
    }
    alert.push(al);
  }
  app.alert[key] = alert;

  // Populate APP.PLAY (Card play, number of tricks claimed)
  let cardplay = [];
  const scp = doc.getElementsByTagName("sc_card_played");
  for (let i = 0; i < scp.length; i++) {
    // Normally the cards are uppercase but Vugraph card data is lowercase (why?!)
    // Standardize on uppercase.
    cardplay.push(scp[i].getAttribute("card").toUpperCase());
  }

  app.play[key] = { cardplay };
  const smc = doc.getElementsByTagName("sc_claim_accepted");
  if (smc.length !== 0) {
    app.play[key].nclaimed = parseInt(smc[0].getAttribute("tricks"));
  }

  // Bail if user doesn't want double dummy.
  if (pref.appDoubleDummyMode === "off") {
    return;
  }

  [d.dealer, d.vul] = bsolDealerVul(d.bnum);

  const sc = doc.getElementsByTagName("sc_call_made");
  let lix = sc.length - 1;
  let completedAuction =
    sc.length > 3 &&
    sc[lix].getAttribute("call") === "p" &&
    sc[lix - 1].getAttribute("call") === "p" &&
    sc[lix - 2].getAttribute("call") === "p";

  if (completedAuction) {
    d.contract = sc[lix - 3].getAttribute("call");
  }

  // Hide current dummy dummy information because board will soon change.
  const ed = elDealViewer("session");
  if (ed !== undefined) {
    const dv = ed.getElementsByClassName("bhDoubleDummy")[0];
    if (dv !== undefined) {
      dv.hidden = true;
    }
    const dv2 = ed.getElementsByClassName("bhDoubleDummyPar")[0];
    if (dv2 !== undefined) {
      dv2.hidden = true;
    }
  }

  const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
  doubledummy(d, bCacheOnly, historyDDcallback);
}

function mh_hand(response) {
  // Parse hands out of response to mh_hand PHP request and populate APP.CARDPLAY,
  // issue real name queries, and query John Goacher's BSOL for double dummy info.

  const parser = new DOMParser();
  const doc = parser.parseFromString(response, "application/xml");

  const linhand = doc.getElementsByTagName("linhand")[0];
  if (linhand === undefined) {
    // Sometimes the query fails (seen this when querying Robot Race hands after
    // event completed).
    const s = doc.getElementsByTagName("status")[0];
    if (s === undefined) {
      console.warn(
        "BBO Helper: mh_hand(): No <linhand> or <status> element in response"
      );
    } else {
      console.warn(
        "BBB Helper: mh_hand(): No <linhand> in response, err=%s, errmsg=%s",
        s.getAttribute("err"),
        s.getAttribute("errmsg")
      );
    }
    return;
  }

  // const hk = linhand.getAttribute('hk');  // Not used
  const lin = linhand.innerHTML;

  // Fetch info about players from the player database.
  let pnames;
  let pnameMatch = lin.match(/(?<=pn\|)[^|]+/);
  if (pnameMatch !== null) {
    pnames = pnameMatch[0].split(",");
    for (let i = 0; i < pnames.length; i++) {
      let bbohandle = pnames[i].toLowerCase();
      if (!realnames.hasOwnProperty(bbohandle)) {
        browser.runtime
          .sendMessage({ type: "lookup", bbohandle: pnames[i].toLowerCase() })
          .then(realnameResponse);
      }
    }
  }

  let hand = linboard2dotboard(lin2hands(lin));

  // Key for saving alerts and card play
  const key = hand.join("+") + "-" + pnames[0].toLowerCase();
  console.info("BBO Helper: mh_hand() cardplay key", key);

  // Populate APP.ALERT
  let alert = [];
  let actions = lin.split("|");
  for (let i = 0; i < actions.length; i += 2) {
    if (actions[i] !== "mb") {
      continue;
    }
    if (actions[i + 2] === "an") {
      alert.push(actions[i + 3]);
      i += 2;
      continue;
    }
    alert.push(actions[i].endsWith("!") ? "" : undefined);
  }
  app.alert[key] = alert;

  // Populate APP.PLAY
  app.play[key] = { cardplay: lin.match(/(?<=\|pc\|)[^|]+/g) };
  const nclaimed = lin2claimed(lin);
  if (nclaimed !== undefined) {
    app.play[key].nclaimed = nclaimed;
  }

  // Done if not also requesting double dummy result.
  if (pref.appDoubleDummyMode === "off") {
    return;
  }

  const bnum = parseInt(lin.match(/(?<=\|Board )\d+(?=\|)/)[0]);
  let d = { bnum: bnum, hand: hand, contract: "", source: "review" };
  [d.dealer, d.vul] = bsolDealerVul(d.bnum);

  // Figure out the contract.
  let au = lin.match(/(?<=\|mb\|)[^|]+/g);
  if (au !== null) {
    // NULL if no calls were made
    let lix = au.length - 1;
    let completedAuction =
      au.length > 3 &&
      au[lix] === "p" &&
      au[lix - 1] === "p" &&
      au[lix - 2] === "p";

    if (completedAuction) {
      d.contract = au[lix - 3];
    }
  }

  // Hide current dummy dummy information because board will soon change. (Strictly
  // speaking mh_hand.php responses can also be in response to request for boards
  // played at the current session, if the session is completed. So 'review' here
  // is sometimes wrong but has no consequence.)
  const ed = elDealViewer("review");
  if (ed !== undefined) {
    const dv = ed.getElementsByClassName("bhDoubleDummy")[0];
    if (dv !== undefined) {
      dv.hidden = true;
    }
    const dv2 = ed.getElementsByClassName("bhDoubleDummyPar")[0];
    if (dv2 !== undefined) {
      dv2.hidden = true;
    }
  }

  const bCacheOnly = pref.appDoubleDummyMode === "ondemand";
  doubledummy(d, bCacheOnly, historyDDcallback);
}

async function historyBoardChange(mutations) {
  // There can be multiple mutation records in one callback though here we only
  // expect one. If the board number has changed multiple times, we only care
  // about the final board number.
  let mrlast;
  for (let mr of mutations) {
    // Should only be receiving characterData mutation records.
    if (mr.type !== "characterData") {
      continue;
    }
    mrlast = mr;
  }

  // There are separate dummy dummy related <div> elements for separate deal viewers.
  // When we create the mutation observer, we store which one it is as a custom
  // attribute so we don't have to walk up the DOM to <result-list-screen> or
  // <history-screen>
  const mode = mrlast.target.parentNode.getAttribute("data-bbmode");

  console.info(
    "BBO Helper: historyBoardChange(): Board number in %s History pane " +
      "has changed from %d to %d",
    mode,
    mrlast.oldValue,
    mrlast.target.data
  );
  if (mode === null) {
    console.warn(
      "BBO Helper: historyBoardChange(): Did not find expected " +
        "data-bbmode attribute"
    );
    return;
  }

  const ed = elDealViewer(mode);

  // See if currently displayed double dummy information is invalid. If new
  // double dummy information has already been inserted due to <sc_board_details>
  // message or "mh_hand" PHP processing, then we are okay.
  const dv = ed.getElementsByClassName("bhDoubleDummy")[0];
  if (
    dv !== undefined &&
    dv.getAttribute("data-bnum") !== parseInt(mrlast.target.data)
  ) {
    // Hide now invalid double dummy display if present.
    dv.hidden = true;
    const dv2 = ed.getElementsByClassName("bhDoubleDummyPar")[0];
    if (dv2 !== undefined) {
      dv2.hidden = true;
    }

    if (pref.appDoubleDummyMode !== "off") {
      let d = await getDealViaDOM(mode, false);
      if (d === undefined) {
        console.error(
          "BBO Helper historyBoardChange(): " + "No deal found for board",
          mrlast.target.data
        );
        return;
      }
      d.source = mode;

      /// console.info('BBO Helper: doubledummy() invoked for board', d.bnum);
      let bCacheOnly = pref.appDoubleDummyMode === "ondemand";
      doubledummy(d, bCacheOnly, historyDDcallback);
      //   loadMiddleSection(d);
    }
  }
}

async function historyDDcallback(d, dd) {
  // Add double dummy information to the appropriate <deal-viewer>

  // Bail if something went wrong with fetching double dummy calculation.
  if (dd === undefined) {
    return;
  }

  // If the double dummy was cached, we might arrive here before the UI has
  // finished rendering, so try a few times. If it wasn't cached, UI should be
  // rendered by time we get here.
  const maxTries = dd.wasCached ? 11 : 2;
  const sleepTime = 500;

  for (let itry = 0; itry < maxTries; itry++) {
    let response = await showDoubleDummy(d, dd);
    loadMiddleSection(app);
    if (response) {
      let timestr = ((sleepTime * itry) / 1000).toFixed(1);
      if (response === "done") {
        console.info(
          "BBO Helper: historyDDcallback(): rendered %s double dummy " +
            "info %s seconds after receipt",
          d.source,
          timestr
        );
      } else {
        console.info(
          "BBO Helper: historyDDcallback(): gave up rendering %s " +
            "double dummy info %s seconds after receipt because: %s",
          d.source,
          timestr,
          response
        );
      }
      return;
    }

    // BBO UI is not fully rendered. Wait and try again.
    await sleep(sleepTime);
  }

  const timestr = ((sleepTime * maxTries) / 1000).toFixed(1);
  const msg =
    "BBO Helper: historyDDcallback(): unable to render %s double dummy " +
    "information after %s seconds. (Can happen if board details from another table " +
    "in current session are requested after session has completed.)";
  console.info(msg, d.source, timestr);
}

async function showZachTab() {}

async function showDoubleDummy(d, dd) {
  // Add double dummy information to the correct <deal-viewer> Returns undefined
  // if posssibly waiting for UI to finish rendering, 'done' if successful, and
  // other messages if further attempts should not be made. Returning undefined
  // means another attempt can be made.

  const ed = elDealViewer(d.source);

  // Still want to allow further attempts because BBO UI may not have created
  // board in history panel if this is the first board of the session.
  if (ed === undefined) {
    return;
  }

  // Parse board number out of the center of the vulnerability indicator.
  const elVulPanel = ed.getElementsByClassName("vulPanelInnerPanelClass")[0];
  if (elVulPanel === undefined) {
    return;
  } // Shouldn't happen, just a guard

  // Add an event listener to detect board number changes in the BBO app if
  // it has not already been done. Need this because we will not have an
  // <sc_board_details> message or "mh_hand" PHP request if the user switches
  // to a hand in the History pane that is cached because it has already been
  // viewed once during the BBO session.
  if (elVulPanel.getAttribute("data-bhMutationObserverAdded") === null) {
    const observer = new MutationObserver(historyBoardChange);
    // "subtree: true" is necessary here
    const config = {
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    };
    observer.observe(elVulPanel, config);

    elVulPanel.setAttribute("data-bhMutationObserverAdded", 1);
    elVulPanel.setAttribute("data-bbMode", d.source);
  }

  const hd = ed.getElementsByClassName("handDiagramPanelClass");
  // Guard against UI changes.
  if (hd.length !== 4) {
    return "did not find 4 elements with handDiagramPanelClass";
  }

  // There isn't a good place to put the double dummy table in Pictures of Cards display.
  const picturesOfCards = hd[0].style.display === "none";
  if (picturesOfCards) {
    // Hide double dummy display.
    const dv = ed.getElementsByClassName("bhDoubleDummy")[0];
    if (dv) {
      dv.hidden = true;
    }

    return "double dummy does not work with pictures of cards";
  }

  // Deal viewer hasn't finished rendering yet. Sometime happens when first
  // selecting a tournament for review. mh_hand() pulls cached double dummy
  // before rendering can finish.
  if (elVulPanel.innerText === "") {
    return;
  }

  // It is also possible that the user has switched to a different board since
  // the double dummy request was fired off. Make a simple check.
  const bnum = parseInt(elVulPanel.innerText);
  if (d.bnum !== bnum) {
    // Don't give up immediately if board number is 99. The BBO UI seems to set the
    // board number of a never used deal viewer to 99 (actually " 99" I think vs
    // "99" for the actual board 99, but by this point we've converted to a number).
    if (bnum === 99) {
      console.log("Board 99");
      return;
    } ///
    return `board number does not match, expected ${d.bnum}, found ${bnum}`;
  }

  // In rare cases the user could have has changed table ('session' mode)
  // or switch to reviewing a different session ('review' mode) and just
  // happened to have selected the same board number. Make a further check
  // based on the deal. However, this check can only be carried out if we
  // can grab the full deal from the deal viewer (i.e. they haven't play
  // through tricks.
  let d2 = await getDealViaDOM(d.source);
  let dealsMatch = true;
  for (let i = 0; i < 4; i++) {
    if (d2.hand[i].length === 16 && d.hand[i] !== d2.hand[i]) {
      dealsMatch = false;
      break;
    }
  }
  if (!dealsMatch) {
    return "deals do not match";
  }

  // Make sure West and South hand diagrams have been positioned by the browser;
  // otherwise we don't know where to position the double dummy diagram.
  if (hd[1].offsetTop === 0 || hd[0].offsetHeight === 0) {
    return;
  }

  // Good to go (true --> inline CSS)
  let [ddtablehtml, parhtml] = ddhtml(dd, "History", true);
  /// console.info(ddtablehtml, parhtml);

  // Green felt of the deal (in the History pane)
  const felt = ed.getElementsByClassName("coverClass")[0];

  // Place double dummy table in the lower right corner.
  let dv = ed.getElementsByClassName("bhDoubleDummy")[0];
  if (dv === undefined) {
    dv = document.createElement("div");
    dv.setAttribute("class", "bhDoubleDummy");
    // z-index of -1 so that it doesn't overlap the South hand if it is too wide.
    // Relative font-size. BBO app adjust the font depending on the width of the
    // deal view area.
    dv.style =
      "position: absolute; padding: 0.1em 0.3em 0.3em 0.2em; " +
      "border-style: solid; border-width: 1px; border-color: #808080; " +
      "z-index: -1; background: white";
    dv.innerHTML = ddtablehtml;

    felt.appendChild(dv);
  } else {
    dv.hidden = false;
    dv.innerHTML = ddtablehtml;
  }

  // Record the board number that the double dummy applies to so we can check if
  // it is out of sync with the board number later.
  dv.setAttribute("data-bnum", d.bnum);

  const westWidth = hd[1].offsetWidth;
  const southHeight = hd[0].offsetHeight;

  // 90% seems to work pretty well but sometimes it is too big. Dial back the font
  // size if necessary until it fits.
  for (let fontSize = 90; fontSize > 50; fontSize -= 10) {
    dv.style.fontSize = fontSize + "%";
    if (dv.offsetWidth < 0.96 * westWidth && dv.offsetHeight < southHeight) {
      break;
    }
  }

  // Place it in the lower left corner, centered horizontally below the West hand and
  // centered vertically to the left of the South hand. Nice integer positioning.
  let x = hd[1].offsetLeft + (westWidth - dv.offsetWidth) / 2;
  let westBottom = hd[1].offsetTop + hd[1].offsetHeight;
  let y = westBottom + (felt.offsetHeight - westBottom - dv.offsetHeight) / 2;
  dv.style.left = x.toFixed(0) + "px";
  dv.style.top = y.toFixed(0) + "px";

  // Place par contracts at the bottom of the upper right area.
  let dv2 = ed.getElementsByClassName("bhDoubleDummyPar")[0];
  if (dv2 === undefined) {
    dv2 = document.createElement("div");
    dv2.setAttribute("class", "bhDoubleDummyPar");
    dv2.style =
      "position: absolute; padding: 0.2em 0.3em 0.2em 0.2em; " +
      "border-style: solid; border-width: 1px; border-color: #808080; " +
      "z-index: -1; background: red";
    dv2.innerHTML = parhtml;

    felt.appendChild(dv2);
  } else {
    dv2.hidden = false;
    dv2.innerHTML = parhtml;
  }

  // No wider than the East hand. Force par contract(s) to wrap to another line
  // if necessary.
  dv2.style.maxWidth = (0.97 * hd[3].offsetWidth).toFixed(0) + "px";

  x = hd[2].offsetLeft + 1.03 * hd[2].offsetWidth;
  const northBottom = hd[2].offsetTop + 0.99 * hd[2].offsetHeight;
  y = northBottom - dv2.offsetHeight;
  dv2.style.left = x.toFixed(0) + "px";
  dv2.style.top = y.toFixed(0) + "px";

  return "done";
}

async function getDealViaDOM(mode, needAuction) {
  // Obtain the currently displayed deal by directly reading the DOM.
  //
  // Note: Different from same named function in handviewer.js because
  // although the DOM is similar it is not quite the same.
  //
  // MODE - 'session', 'review', or 'visible'

  let d = { name: [] };

  if (mode === "visible") {
    mode = whatHistoryScreen();
  }
  if (mode === undefined) {
    console.info("BBO Helper: BBO History screen not visible.");
    return;
  }

  const ed = elDealViewer(mode);
  if (ed === undefined) {
    console.info("BBO Helper: No <deal-viewer> found in %s History.", mode);
    return;
  }

  // For quick and dirty rejection.
  let inn = ed.innerText;

  // Return if deal viewer is not populated with a hand yet. Might not need both
  // of these checks anymore.
  if (inn.substring(0, 3) === "S\x0aW") {
    // Happens when tournament has been selected in History pane but no board
    // has been selected.
    console.info("BBO Helper: <deal-viewer> not populated yet (check 1).");
    return;
  }

  // Ignore unpopulated and hidden deal-viewer. This check catches case where
  // History pane is selected but no deal is selected.
  if (inn.substr(0, 16) === " Score  Rank: 99") {
    console.info("BBO Helper: <deal-viewer> not populated yet (check 2).");
    return;
  }

  console.info(
    "BBO Helper: getDealViaDOM(): Found visible deal for %s",
    mode === "session" ? "current session" : "a previous session"
  );

  // Board is not always fully rendered at this point. For example the auction
  // is often slow to load when examining board from other tables.

  let sleepTime = 500,
    maxTries = 7; // half a second
  let success = false;
  for (let itry = 0; itry < maxTries; itry++) {
    // If board is not fully rendered, wait and try again.
    if (itry) {
      await sleep(sleepTime);
    }

    // Grab the board number.
    const vpc = ed.getElementsByClassName("vulPanelInnerPanelClass");
    if (vpc.length === 0) {
      continue;
    }
    d.bstr = vpc[0].innerText;
    d.bnum = parseInt(d.bstr);

    // Grab the BBO player handles.
    const namedivs = ed.getElementsByClassName("nameDisplayClass");
    if (namedivs.length === 0) {
      continue;
    }

    let haveAll = true;
    for (let i = 0; i < 4; i++) {
      d.name[i] = namedivs[i].innerText;
      if (d.name === "") {
        haveAll = false;
        break;
      }
    }
    if (!haveAll) {
      continue;
    }

    // Grab contract and declarer.
    const tpc = ed.getElementsByClassName("tricksPanelClass");
    if (tpc.length === 0) {
      continue;
    }

    if (tpc[0].style.display === "none") {
      // Passed out hand
      d.contract = undefined;
      d.declarer = undefined;
      d.tNS = 0;
      d.tEW = 0;
    } else {
      let abc = tpc[0].getElementsByClassName("auctionBoxCellClass");
      let contract = abc[0].innerText;

      // Notrump varies depending on the user's language, but if it is not
      // a symbol it is notrump.
      let symbol = contract.charAt(1);
      let denomLetter =
        symbol === "♠"
          ? "S"
          : symbol === "♥"
          ? "H"
          : symbol === "♦"
          ? "D"
          : symbol === "♣"
          ? "C"
          : "N";
      d.contract = contract.charAt(0) + denomLetter;

      let tplc = tpc[0].getElementsByClassName("tricksPanelTricksLabelClass");
      d.declarer = tplc[0].innerText.substr(0, 1);
      d.tNS = parseInt(tplc[1].innerText);
      d.tEW = parseInt(tplc[2].innerText);
    }

    success = true;
    break;
  }

  if (!success) {
    console.error(
      "BBO Helper getDealViaDOM(): Deal not rendered after %d seconds.",
      (sleepTime * (maxTries - 1)) / 1000
    );
    return;
  }

  // Unfortunately we cannot just use the innerHTML to pickup the entire hand because
  // when there is a void in a suit (more common as tricks are played out), the
  // innerText (on Firefox at least), does not contain a newline for the void suit.
  // So we have to dig in. Order returned here is South, West, North, East (i.e.
  // clockwise).
  const hd = ed.getElementsByClassName("handDiagramPanelClass");

  // handL[] is the localized string where honor cards may be reperesnted
  // by different letters. hand[] is tne "standard" AKQJ English representation.
  let handL = [];

  // BBO hand order is South, West, North, East.
  for (let i = 0; i < 4; i++) {
    // Order of these elements is Clubs, Diamonds, Hearts, Spades.
    const suits = hd[i].getElementsByClassName("suitPanelClass");
    // If Deal Viewer option "Show played cards" is on, innerText will
    // include the played cards.
    //
    // The Deal Viewer has two layout modes: "Hand Diagrams" and "Pictures of Cards".
    // If the first mode innerText will just be the card values. If the second mode,
    // innerText has spaces and newlines.

    // Reorder to standard Spades, Hearts, Diamonds, Clubs.
    handL[i] =
      suits[3].innerText +
      "." +
      suits[2].innerText +
      "." +
      suits[1].innerText +
      "." +
      suits[0].innerText;

    // Replace two character "10" rank with T. (Need global; 10 may be in multiple
    // suits). Second replace wipes out whitespace present in "Pictures of Cards" mode.
    handL[i] = handL[i].replace(/10/g, "T").replace(/\s/g, "");
  }

  let hand = handEnglish(handL, app.locale.honorLetters);

  // GIB, PBN order for deal field.
  d.deal = hand[1] + ":" + hand[2] + ":" + hand[3] + ":" + hand[0];
  d.hand = hand;
  d.handL = handL;

  [d.dealer, d.vul] = bsolDealerVul(isNaN(d.bnum) ? 1 : d.bnum);

  // The BBO application often takes a couple of seconds to display the auction
  // after showing the rest of the board. Don't wait if caller doesn't need
  // auction (and HCP).
  if (!needAuction) {
    return d;
  }

  // Grab the auction. This works even if the auction box is no longer visible.
  // Bidding is presented W N E S but first bid will be by dealer, i.e. there
  // aren't any placeholders if West is not dealer.
  const ab = ed.getElementsByTagName("auction-box")[0];
  let calls = ab.getElementsByClassName("auctionBoxCellClass");

  // Try many times because the BBO application is rather slow to bring
  // up the auction when examining deals played at another table.
  maxTries = 9;
  success = false;
  for (let itry = 0; itry < maxTries; itry++) {
    // BBO application has not finished rendering the hand yet. Delay 0.5 sec.
    if (itry) {
      await sleep(sleepTime);
    }

    let haveAllCalls = true;
    let auctionstr = "";
    d.auction = [];
    for (let i = 0; i < calls.length; i++) {
      let call = calls[i].innerText;
      if (call === "") {
        haveAllCalls = false;
        break;
      }

      // Standardize to P, X, XX and C,D,H,S for suit symbols for downstream code.
      // From BBO application we have 'Pass', 'Dbl', 'Rdbl' (in English), and
      // Unicode symbols for the suits.
      if (call.length === 2) {
        const symbol = call.substr(-1);
        const suitletter =
          symbol === "♠"
            ? "S"
            : symbol === "♥"
            ? "H"
            : symbol === "♦"
            ? "D"
            : "C";
        call = call.charAt(0) + suitletter;
      }
      // Notrump designation is language dependent (NT in English, SA ('Sans Atout')
      // in French and Italian, UT in Danish
      else if (call.substring(1) === app.locale.nt) {
        call = call.charAt(0) + "N";
      } else if (call === app.locale.pass) {
        call = "P";
      } else if (call === app.locale.dbl) {
        call = "X";
      } else if (call === app.locale.rdbl) {
        call = "XX";
      }

      d.auction[i] = call;
      auctionstr += call;
      if (i % 4 === 3 && i !== calls.length - 1) {
        auctionstr += ";";
      }
      if (i !== calls.length - 1) {
        auctionstr += " ";
      }
    }

    if (haveAllCalls) {
      success = true;
      d.auctionstr = auctionstr;
      break;
    }
  }

  if (!success) {
    console.error(
      "BBO Helper getDealViaDOM(): Auction not rendered after %d seconds.",
      (sleepTime * (maxTries - 1)) / 1000
    );
    return;
  }

  // Track whether it is a hand from a Vugraph session because player usernames,
  // are those of the viewgraph presenter rather than the BBO handle of each player.
  // Test MODE first because APP.TABLE will be undefined if not at a table.
  d.isVugraph =
    mode === "session" && app.table && app.table.style === "vugraph";

  // Add contract info based on the bidding sequence.
  d = contract(d);

  // Add "hcp" and "whohas" fields.
  d = dealHCP(d);

  return d;
}

async function analyze() {
  // Launch Bridge Solver Online (BSOL) double dummy solver for current hand.

  // Don't absolutely need the auction but it is nice to have it now that we are
  // invoking BSOL using the LIN parameter so call with TRUE.
  let d = await getDealViaDOM("visible", true);
  if (d === undefined) {
    console.info("BBO Helper analyze(): No deal available");
    return;
  }

  // APP.PLAY stores card play and number of tricks claimed for deals played or observed.
  // Need to check that key is defined because Bidding tables do not store cardplay.
  const key = d.hand.join("+") + "-" + d.name[0].toLowerCase();
  if (app.play[key] !== undefined) {
    d.cardplay = app.play[key].cardplay;
    d.nclaimed = app.play[key].nclaimed;
  }

  bsol(d);
}

async function createpbn() {
  // Create a PBN file for the current board.

  let d = await getDealViaDOM("visible", true);
  if (d === undefined) {
    console.info("BBO Helper createpbn(): No deal available");
    return;
  }

  // APP.PLAY stores card play and number of tricks claimed for deals played or observed.
  // Need to check that key is defined because Bidding tables do not store cardplay.
  const key = d.hand.join("+") + "-" + d.name[0].toLowerCase();
  if (app.play[key] !== undefined) {
    d.play = app.play[key].cardplay;
    d.nclaimed = app.play[key].nclaimed;
  }

  let dealTiming = await getDealTiming(d.hand, d.name);

  if (dealTiming !== undefined) {
    d.auctionTimes = dealTiming.auctionTimes;
    d.playTimes = dealTiming.playTimes;
  }

  // Include "optimal" contracts but only if cached (2nd parameter)
  // for good responsiveness.
  let dd = await doubledummy(d, true);
  if (dd) {
    d.dd = dd;
  }

  let pbn = deal2pbn(d);

  // Explicitly convert to "\r\n" (CRLF) line termination here because we push
  // it down as a BLOB (so no automatic OS style conversion).
  pbn = pbn.replace(/\n/g, "\r\n");

  const fname = "Board " + d.bnum + ".pbn";

  let blob = new Blob([pbn], { type: "text/plain" });
  saveAs(blob, fname);
}

async function copyboard(mode) {
  // Toggles the display of the Board Copy-and-Paste Aid.

  const dv = document.getElementById("bh-board-copy-aid");
  if (mode === "toggle") {
    if (dv !== null) {
      dv.remove();
      return;
    }
  } else if (mode === "refresh") {
    if (dv === null) {
      return;
    }
  } else {
    console.error("BBO Helper copyboard(): Invalid mode: ", mode);
  }

  let d = await getDealViaDOM("visible", true);
  if (d === undefined) {
    console.info("BBO Helper copyboard(): No deal available");
    return;
  }

  // APP.PLAY stores card play and number of tricks claimed for deals played or observed.
  const key = d.hand.join("+") + "-" + d.name[0].toLowerCase();

  if (app.play[key] !== undefined) {
    d.cardplay = app.play[key].cardplay;
    d.nclaimed = app.play[key].nclaimed;
    d.alert = app.alert[key];
  }

  // Future improvement: try to set d.datestr and d.title
  // Different handling than in the BBO Hand Viewer.

  if (pref.boardShowDoubleDummy) {
    // Only if cached (2nd parameter) for good responsiveness.
    let dd = await doubledummy(d, true);
    if (dd) {
      d.dd = dd;
    }
  }

  console.info("BBO Helper: copyboard() deal:", d.deal);
  console.info("BBO Helper: copyboard() auction:", d.auctionstr);

  showCopyAid(d, "bbo");
}

async function toggleNameDisplay() {
  // Display (or hides) popup showing real names + home state/province of each
  // player at the table.
  let dv = document.getElementById("bh-names");
  if (dv !== null) {
    dv.remove();
    return;
  }

  const felt = elPlayingFelt();
  if (!felt) {
    return;
  } // Bail if not playing or kibitzing.

  dv = document.createElement("div");
  dv.id = "bh-names";

  let ix = app.table.myseatix;
  if (ix === undefined) {
    ix = 0;
  } // If kibitzing, bottom is South.

  let desc = [];
  for (let i = 0; i < 4; i++) {
    let bbohandle = app.table.players[i].toLowerCase();
    if (bbohandle.startsWith("~~")) {
      desc[i] = "Robot " + app.table.players[i];
      continue;
    }

    if (app.table.style === "vugraph") {
      let fullname = vgnames[app.table.players[i]];
      desc[i] = fullname === undefined ? app.table.players[i] : fullname;
      continue;
    }

    const p1 = realnames[bbohandle];
    const p2 = bboprofiles[bbohandle];
    if (p1) {
      desc[i] = p1.fullname;
      if (p1.state !== "") {
        desc[i] += " (" + p1.state + ")";
      }
    } else if (p2 && p2.name !== "") {
      desc[i] = p2.name;
      if (p2.country !== "") {
        desc[i] += " (" + p2.country + ")";
      }
    } else {
      desc[i] = app.table.players[i]; // Original case
    }
  }

  let html = "";
  html +=
    '<div style="position: absolute; top: 3%; width: 90%; ' +
    'text-align: center">' +
    desc[(ix + 2) % 4] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; top: 35%; left: 3%; height: 10%">' +
    desc[(ix + 1) % 4] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; top: 54%; right: 3%; height: 10%">' +
    desc[(ix + 3) % 4] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; bottom: 3%; width: 100%; ' +
    'text-align: center">' +
    desc[ix] +
    "</div>" +
    "\n";

  dv.innerHTML = html;

  // Create close "button" at the upper right.
  const imgClose = document.createElement("img");
  imgClose.src = browser.runtime.getURL("buttons/close-button-32.png");
  imgClose.style = "float: right; border: none";
  imgClose.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      dv.remove();
    },
    true
  );
  dv.insertAdjacentElement("afterbegin", imgClose);

  // Auction box uses a z-index of 700. So bigger than this.
  dv.style =
    "position: absolute; padding: 0.2em 0.2em 0.2em 0.2em; " +
    "background: white; color: blue; height: 12em; width: 12em; " +
    "font-size: 150%; font-family: sans-serif; z-index: 1200; opacity: 0.95; " +
    "border: 1px solid #7f7f7f";

  felt.appendChild(dv);

  // Display auto-alert msg centered in the auction box.
  const left_px = (felt.offsetWidth - dv.offsetWidth) / 2;
  const top_px = (felt.offsetHeight - dv.offsetHeight) / 2;
  dv.style.left = left_px + "px";
  dv.style.top = top_px + "px";
}

function dealmessage(message) {
  // Display a brief message centered in the <div> that displays the hand.

  const rvp = document.getElementsByTagName("deal-review-screen");
  if (rvp.length === 0) {
    return;
  } // Guarding against BBO UI changes.

  const ec = rvp[rvp.length - 1].getElementsByTagName("deal-viewer");
  console.info(
    "BBO Helper: " +
      " %d <deal-viewer> element(s) found in last 'deal-review-screen.'",
    ec.length
  );

  if (ec.length === 0) {
    return;
  } // Not initialized yet

  // Should only be one. But still figuring this out.
  console.eror("BBO Helper: %d 'deal-viewer' element(s) found.", ec.length);

  const ed = ec[0];

  let dv = document.createElement("div");
  dv.innerText = message;

  dv.style =
    "position: relative; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; " +
    "background: #cccc9a; color: blue; width: 6em; " +
    "font-size: 150%; font-family: sans-serif";

  ed.parentElement.appendChild(dv);

  // <deal-viewer> is a zero size Angular flex object. But can get the size
  // from the parent <div> with has class of "contentClass".
  const left_px = (ed.parentElement.offsetWidth - dv.offsetWidth) / 2;
  const top_px = (ed.parentElement.offsetHeight - dv.offsetHeight) / 2;
  dv.style.left = left_px + "px";
  dv.style.top = top_px + "px";

  setTimeout(() => {
    dv.remove();
  }, 1500);
}

function playclock(seatix, msec) {
  // SEATIX run from 0-3 (S, W, N, E - Standard BBO order)

  // Bail if play clock is not requested and wasn't previously being shown,
  // i.e. does not need to be hidden.
  if (!pref.appShowPlayClock && !app.showPlayClock) {
    return;
  }

  // This includes the card play area, hamburger menu, board num, etc
  const dsc = document.getElementsByClassName("dealScreenDivClass");
  if (dsc.length === 0) {
    return;
  } // guarding against BBO UI changes
  // This is the just the card playing area, the "green felt"
  const felt = dsc[0].getElementsByClassName("coverClass")[0];
  if (felt === undefined) {
    return;
  }

  app.showPlayClock = pref.appShowPlayClock;

  let dv = felt.getElementsByClassName("bhPlayClock");

  if (dv.length !== 0 && !pref.appShowPlayClock) {
    // User turned off the play clock, so hide existing clocks.
    for (let i = 0; i < 4; i++) {
      dv[i].hidden = true;
    }
    return;
  }

  if (dv.length === 0) {
    for (let i = 0; i < 4; i++) {
      // Create a clock for each seat.
      const sdv = document.createElement("div");

      sdv.setAttribute("class", "bhPlayClock");
      sdv.style =
        "position: absolute; padding: 0.2em 0.2em 0.2em 0.2em; " +
        "background: white; color: blue; width: 1.6em; text-align: center; " +
        "font-size: 150%; font-family: sans-serif; border-radius: 7px";
      sdv.hidden = true;

      felt.appendChild(sdv);
    }
    dv = felt.getElementsByClassName("bhPlayClock");
  }
  if (app.trick.cards.length === 1) {
    // Hide clocks for seats which haven't played to the trick yet.
    for (let i = 0; i < 4; i++) {
      if (i !== seatix) {
        dv[i].hidden = true;
      }
    }
  }

  const sec = msec / 1000;
  dv[seatix].innerText = sec >= 9.95 ? sec.toFixed(0) : sec.toFixed(1);

  // If player is not seated (i.e. is kibitzing), bottom seat is South. TSEATIX is
  // seat order as 'bottom', 'left', 'top', 'right'
  let tseatix =
    app.table.myseatix === undefined
      ? seatix
      : (4 + seatix - app.table.myseatix) % 4;

  // BBO allows Pictures of Cards (default) vs. not and Animated vs. not.
  // Note: Pictures of Cards only applies when you are play. When you are
  // kibitzing you are in Hand Diagram mode regardless of this setting.
  const hd = felt.getElementsByClassName("handDiagramPanelClass");
  if (hd.length !== 4) {
    return;
  } // Guard against UI changes.
  const picturesOfCards = hd[0].style.display === "none";

  if (picturesOfCards) {
    // We are in Pictures of Cards mode.

    // Center of the trick. It's centered on felt horizontally but very slightly
    // offset toward the bottom vertically.
    const fcx = 0.5 * felt.offsetWidth;
    const fcy = 0.52 * felt.offsetHeight;

    // Distance from center to edge of card allowing for the way BBO overlaps
    // the cards in a trick.
    const cardH = 0.95 * app.cardHeight;
    const cardW = 0.96 * app.cardWidth;

    const space = Math.round(cardW / 10);

    // Unhide <div> before we reference offsetWidth and offsetHeight.
    // Otherwise these values are 0.
    dv[seatix].hidden = false;
    const dw = dv[seatix].offsetWidth;
    const dh = dv[seatix].offsetHeight;

    // Offset wrt to center of the felt.
    let xoff, yoff;

    if (tseatix === 0) {
      // Position time to right of the bottom right of the bottom card.
      xoff = 0.535 * app.cardWidth + space;
      yoff = cardH - dh;
    } else if (tseatix === 2) {
      // Position time to the left of the upper left of the top card.
      xoff = -0.535 * app.cardWidth - space - dw;
      yoff = -cardH;
    } else if (tseatix === 1) {
      // Position time to the left of the bottom left of the left card.
      xoff = -cardW - space - dw;
      yoff = 0.59 * app.cardHeight - dh;
    } else if (tseatix === 3) {
      // Position time to the right of the top right of the right card.
      xoff = cardW + space;
      yoff = -0.59 * app.cardHeight;
    }

    dv[seatix].style.left = fcx + xoff + "px";
    dv[seatix].style.top = fcy + yoff + "px";
    /// console.info(seatix, tseatix, xoff, yoff);
  } else {
    // We are in Hand Diagram mode.
    // There isn't much room in the center where the trick is displayed. Where to
    // display the times depends on whether we are kibitzing or playing because
    // the BBO hand diagram layout is different in each case.

    const space = 10;
    let ll, lt;
    const col = tseatix === 1 ? 0 : tseatix === 3 ? 2 : 1;
    const row = tseatix === 0 ? 1 : tseatix === 2 ? 3 : 2;

    // Important to unhide first (see above).
    dv[seatix].hidden = false;

    const dw = dv[seatix].offsetWidth;
    const dh = dv[seatix].offsetHeight;

    if (app.table.myseatix === undefined) {
      // We are kibitzing and South hand is at the bottom of the screen.
      // Display timing in to right of top hand and top of right hand.
      // Left and Top offsets for the lower left corner left or trick timing area.
      const ll = hd[2].offsetLeft + hd[2].offsetWidth + 2 * space;
      const lt = hd[3].offsetTop - space;

      dv[seatix].style.left = ll + col * (dw + space) + "px";
      dv[seatix].style.top = lt - row * (dh + space) + "px";
    } else {
      // We are playing and our hand is at the bottom of the screen. Display
      // to the right of our hand.
      const ix = app.table.myseatix;
      const ll = hd[ix].offsetLeft + hd[ix].offsetWidth + 2 * space;
      const mt = hd[ix].offsetTop + hx[ix].offsetHeight / 2;

      dv[seatix].style.left = (ll + col * (dw + space)).toFixed(0) + "px";
      dv[seatix].style.top =
        (mt - dh / 2 + (row - 1) * (dh + space)).toFixed(0) + "px";
    }

    // console.info(seatix, tseatix, col, row, dv[seatix].style.left, dv[seatix].style.top);
  }
}

async function auctionclock(msec) {
  // Shows the time for the last call on the Auction Box if appropriate
  // MSEC = time (in mS). The value "off" --> hides the display

  // Bail if auction clock is not requested and wasn't previously being shown,
  // i.e. does not need to be hidden.
  if (!pref.appShowAuctionClock && !app.showAuctionClock) {
    return;
  }

  const ds = document.getElementsByClassName("dealScreenDivClass");
  if (ds.length === 0) {
    return;
  } // guarding against BBO UI changes

  const ab = ds[0].getElementsByClassName("auctionBoxClass")[0];
  if (ab === undefined) {
    return;
  }

  app.showAuctionClock = pref.appShowAuctionClock;

  let dv = document.getElementById("bhAuctionClock");

  if (dv !== null && (!pref.appShowAuctionClock || msec === "off")) {
    // Either the user has just turn off the auction clock, so hide it,
    // or we need to hide it at the conclusion of the bidding at a Bidding Table.
    dv.hidden = true;
    return;
  }

  if (dv === null) {
    dv = document.createElement("div");
    dv.setAttribute("id", "bhAuctionClock");
    dv.style =
      "position: absolute; padding: 0.2em 0.2em 0.2em 0.2em; " +
      "background: white; color: blue; width: 2.5em; text-align: center; " +
      "font-size: 150%; font-family: sans-serif";

    ab.appendChild(dv);
  } else {
    // In case the user has just turned the auction clock display back on.
    dv.hidden = false;
  }

  const sec = msec / 1000;
  dv.innerText = (sec >= 9.95 ? sec.toFixed(0) : sec.toFixed(1)) + " s";

  // Give browser a little time to finish rendering the auction box if it is
  // newly created. Note: could do this "cleanly" with a Mutation Observer.
  // For a bidding table, a robot will bid immediately, before the dealing
  // animation completes, which in turn occurs before the auction box appears.
  for (let itry = 0; itry < 20; itry++) {
    if (ab.offsetWidth !== 0 && ab.offsetHeight !== 0) {
      break;
    }
    await sleep(250);
  }

  // Need to unhide it if this is the first call of the auction. And need
  // to do this before the next two lines because offsetWidth and offsetHeight
  // are set to zero for hidden elements.
  dv.hidden = false;

  // Display at bottom right of the auction box.
  const left_px = ab.offsetWidth - dv.offsetWidth;
  const top_px = ab.offsetHeight - dv.offsetHeight;
  dv.style.left = left_px + "px";
  dv.style.top = top_px + "px";
}

function auctionContract() {
  // Add declarer and contract, and denom fields to app.deal by examining
  // app.deal.auction[]
  const seatorder = "swne"; // <sc_deal> uses lowercase
  let i1, i2;
  const au = app.deal.auction;

  // Excludes double, redouble, and passes before final contract.
  for (i1 = au.length - 4; i1 >= 0; i1--) {
    if (au[i1].length === 2) {
      break;
    }
  }
  app.deal.contract = au[i1];
  app.deal.denom = au[i1].charAt(1);

  // Figure out who bid the contract denomination first.
  for (i2 = i1 % 2; i2 < au.length - 4; i2 += 2) {
    if (au[i2].charAt(1) === app.deal.denom) {
      break;
    }
  }

  // Figure out declarer (0 = South, 1 = West, ... Standard BBO order)
  app.deal.declarer = (seatorder.indexOf(app.deal.dealer) + i2) % 4;
}

function saveDealTiming() {
  // Invoked when a board is completed (all 52 cards played, accepted claim,
  // arrival at new table because deal was not completed at previous table
  // because time ran out at end of round, new deal at a teaching table, etc)

  const deal = app.deal;
  if (deal === undefined) {
    return;
  }

  if (deal.timingSaved) {
    return;
  }
  app.deal.timingSaved = true;

  const actionTime = deal.actionTime;
  const ncalls = deal.auction.length;

  // Lowercase here because <sc_deal> attributes are lowercase and they
  // populate APP.DEAL via stuffAttributes().
  const seatnames = ["south", "west", "north", "east"];

  // Key by the first hand we know. If we are kibitzing this will be South. If
  // we are playing a social game this will again be South (security hole in BBO).
  // If we are playing a tournament, this will be our hand unless we have become
  // partner is earlier in the rotation.
  //
  // This key isn't absolutely guaranteed to be unique but the odds of someone
  // playing the same hand twice are really low unless a player is replaying a deal.
  // Don't want to key by entire deal because that would use more local storage
  // and we don't always know the full deal when we want to save the timing.
  let key;

  for (let i = 0; i < seatnames.length; i++) {
    let hand = deal[seatnames[i]];
    if (hand === "SHDC") {
      continue;
    } // BBO's placeholder for unknown hand
    key = "tm" + linhand2dothand(hand) + "-" + app.table.players[i];
    break;
  }
  if (key === undefined) {
    console.error("BBO Helper saveDealTiming: No known hand in DEAL:", deal);
    return;
  }

  // Version of packing format.
  const formatVersion = 1;

  // Pack timing information in units of 1/100 sec to minimize local storage use.
  // It seems like this should be handled via a Uint16Array[] or an ArrayBuffer
  // with a Uint16Array view on it but this doesn't work out well because everything
  // placed in local storage has to be representable as JSON. The Uint16Array[]
  // will be expanded in a manner that defeats our desire for compactness and an
  // ArrayBuffer will not get stored at all. So instead we take advantage of the
  // fact that JavaScript strings are stored internally as two bytes per character,
  // as per the language specification.
  let v = new Uint16Array(deal.actionTime.length + 1);
  v[0] = formatVersion + (ncalls << 8);

  let tm;
  for (let i = 0; i < actionTime.length; i++) {
    tm = actionTime[i];
    // Don't allow non-zero time to be rounded down to zero because zero is a
    // special value that indicates we have no timing information because we
    // started observing the auction or play after the hand started and received
    // "catch-up" information all at once.
    if (tm < 5 && tm !== 0) {
      tm = 10;
    } else if (tm >= 552955) {
      // Need to avoid the UTF-16 surrogate code points, i.e. U+D800-U+DBFF
      // (High Surrogates) and U+DC00-U+DFFF (Low Surrogates). A high surrogate
      // followed by a low surrogate is used to encode emojis and such. See
      // http://www.i18nguy.com/surrogates.html. All is good when we have a
      // JavaScript string, but in local storage it is saved as a USVString
      // (https://developer.mozilla.org/en-US/docs/Web/API/USVString), which
      // will replace unpaired high-low surrogates with U+FFFD, the Unicode
      // replacement character, thereby screwing up the timing info.

      // longer than max storage time (0xf7fe encoding shoved up 0xfffe by
      // the Unicode surrogate avoidance.)
      if (tm >= 634865) {
        v[i + 1] = -1;
        continue;
      }
      tm += 20480;
    }

    v[i + 1] = Math.round(tm / 10);
  }

  console.info("BBO Helper: saveDealTiming() key:", key);

  let newitem = {};
  newitem[key] = { d: Date.now(), t: String.fromCharCode(...v) };
  browser.storage.local.set(newitem);
}

function saveDealPlay(nclaimed) {
  // Save card play on a deal to APP.PLAY (which is only retained in memory)
  // Usually APP.PLAY is populated by other means once the full deal is known
  // means aren't triggered at a teaching table.

  // In the places were we call this function, all hands are known.
  const linhand = [
    app.deal.south,
    app.deal.west,
    app.deal.north,
    app.deal.east,
  ];
  const hand = linboard2dotboard(linhand);

  const key = hand.join("+") + "-" + app.table.players[0].toLowerCase();

  app.play[key] = { cardplay: app.deal.play };
  if (nclaimed !== undefined) {
    app.play[key].nclaimed = nclaimed;
  }
}

function savetraffic() {
  // Generate a default filename.
  const sdate = new Date(app.startTime);
  const edate = new Date(Date.now());

  // Example: "18:11:07 GMT-0700 (Pacific Daylight Time)"
  let strLocalTime = sdate.toTimeString();
  if (strLocalTime.charAt(1) === ":") {
    strLocalTime = "0" + strLocalTime;
  }
  const endHHMMSS = edate.toTimeString();

  // Month is zero offset
  let startStrFname =
    sdate.getFullYear() +
    "-" +
    zeroPadInt(sdate.getMonth() + 1, 2) +
    "-" +
    zeroPadInt(sdate.getDate(), 2) +
    " " +
    strLocalTime.substr(0, 8).replace(/:/g, ".");

  let startStrHTML =
    sdate.toDateString() + " " + strLocalTime.substr(0, 8) + " - " + endHHMMSS;
  let fname =
    "BBO Traffic " +
    startStrFname +
    " - " +
    endHHMMSS.substr(0, 8).replace(/:/g, ".") +
    ".htm";

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Created by BBO Helper (Matthew Kidd, San Diego, CA) -->
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="Content-Style-Type" content="text/css">
<meta http-equiv="Content-Script-Type" content="text/javascript">

<title>BBO Client-Server Traffic</title>

<style type="text/css">
body { font-size: 125%; margin: 0.8em 0.4em 0.8em 0.8em; }
.stime, .ipaddr { font-weight: bold; font-size: 120%; }
span.cs { color: red; }
span.sc { color: blue; }
span.xhr-send { color: #ff2a00; }
span.xhr-post { color: #7f00ff; }
span.xhr-resp { color: #006000; }
.pc, .mb, .st, .bd, .deal, .login { font-weight: bold; color: #C89F08; }
</style>
</head>

<body>
<main role="main">
<h1>BBO client-server traffic captured by BBO Helper</h1>
<p class="stime">${startStrHTML}</p>

`;

  if (!pref.appTrafficLoggingFull) {
    let msg =
      "This log does not include cs_ping messages, <sc_ack> responses, " +
      "cs_keepalive and <sc_ack> responses, or <sc_stats> messages. " +
      "Enable full logging to include these.";
    html += "<p>" + escapeHTML(msg) + "</p>\n\n";

    if (!pref.appTrafficLogFeed) {
      let msg = "This log does not include <sc_feed> messages.";
      html += "<p>" + escapeHTML(msg) + "</p>\n\n";
    }
  }

  html += app.traffic;
  html += "</main>\n</body></html>";

  // Explicitly replace \n --> \r\n (CR LF) because we are using BLOB which
  // means there is no automatic conversion to Windows line termination.
  html = html.replace(/\n/g, "\r\n");

  let blob = new Blob([html], { type: "text/plain" });
  saveAs(blob, fname);
}
