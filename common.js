/*
 * Code that is common to all web pages enhanced by BBO Helper
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
 */

// Rarely we have to do something slightly differently in Chrome vs. Firefox
var isChrome = isChromium();

// For Manifest V3, move away from using a polyfill.
if (isChrome) {
  var browser = chrome;
}

// Default preferences
let default_pref = {
  boardIncludeBorder: false,
  boardIncludeNames: true,
  boardPlayerNameMode: "bbohandle", // "seat"
  boardShowAuction: true,
  boardShowContract: true,
  boardShowPlay: true,
  boardShowHCP: true,
  boardShowTiming: true,
  boardShowDateTime: true,
  boardShowLinks: true,
  boardLinksTargetBlank: true,
  boardShowDoubleDummy: true,
  boardShowExplanations: true,
  boardHideRobotExplanations: false,
  boardPartialShowBoardNumber: false,
  boardPartialShowContract: false,
  timingInstantAction: 1,
  timingBIT: 10,
  timimgLongBIT: 30,
  handVoidmdash: true,
  cardUse10: true,
  suitForceBlack: false,
  suitFourColor: false,
  auctionPosition: "center",
  auctionTextNT: "NT",
  auctionShortCalls: true,
  auctionSeatLetters: true,
  auctionBBOstyling: true,
  auctionHideFinalPasses: true,
  appTrafficLogging: true,
  appTrafficLogFeed: false,
  appTrafficLoggingFull: false,
  appTrafficLogHidePassword: true,
  appTrafficMaxKilobytes: 2000,
  appSnifferConsoleLog: false,
  appChatNameSubs: true,
  appChatAutoSuits: true,
  appClaimAutoSuits: true,
  appAutoAlerts: true,
  appAlertSubstitutions: true,
  appShowAuctionClock: true,
  appShowPlayClock: true,
  appShowPeopleTooltip: true,
  appBoardLocalization: true,
  appDoubleDummyTricks: true,
  appDoubleDummyMode: "always",
  hvDoubleDummyMode: "always",
  sessDoubleDummyAlways: false,
  travSuitFourColor: true,
};

// Default automatic alerts
let aa = {
  opening: {
    "1D": "4+ diamonds unless 4=4=3=2",
    "3N": "Gambling. Nothing on side",
    FourthSeat2Bid: "Full opener with 6+ cards",
  },
  nt: { JacobyTransfers: true, TexasTransfers: true, "2S": "Relay to 3!c" },
  ntdef: {
    d: "Single-suited",
    "2C": "!c + higher suit",
    "2D": "!d + higher suit",
    "2H": "!h + !s",
    "2S": "Weak spades and/or only 5",
    "2N": "!c + !d",
  },
  forcingNT: "semi-passed",
  majorJumpRaise: "4 card limit raise",
  majorSplinters: true,
  Jacoby2NT: true,
  invertedMinors: true,
  minorJumpRaise: "5-8 HCP",
  OneTwoJumpResponse: "0-5 HCP, 6+ cards",
  weak2NT: "feature",
  NTovercall: "15-18 HCP",
  NTbalancing: "11-14 (up to 17 against 1!s)",
  directCueBid: { type: "Michaels", style: "5-4-NV-not5422" },
  jump2NT: { type: "Two Lowest", style: "5-4-NV-not5422" },
};

default_pref.aa = aa;

// In memory copy of preferences for best performance, updated by an Event Listener
// when changes are made to options in storage. We begin with default preferences
// in case prefs cans not be loaded from storage (should happen) or they are needed
// before they can be loaded (unlikely race condition that could  be prevent but isn't
// worth the trouble.
var pref = default_pref;

// It would be better to put preference in sync storage. But if user has not set up
// synchronization or is not permitted it for add-ons, then this storage doesn't seem
// to fall back to local storage.
browser.storage.local.get("pref").then(onPrefLoad, (err) => {
  console.error(
    "BBO Helper: couldn't load user preferences: ",
    err,
    " (using defaults)"
  );
});

function onPrefLoad(item) {
  if (Object.keys(item).length === 0) {
    pref = default_pref;
    browser.storage.local.set({ pref: pref }).then(false, (err) => {
      console.error("BBO Helper: failed to save preferences: ", err);
    });
  } else {
    pref = item.pref;
    // Add any new keys from default_pref in later releases of the add-on.
    let newkeys = 0;
    for (let key in default_pref) {
      if (pref[key] === undefined) {
        pref[key] = default_pref[key];
        newkeys++;
      }
    }
    if (newkeys) {
      browser.storage.local.set({ pref: pref }).then(false, (err) => {
        console.error("BBO Helper: failed to save preferences: ", err);
      });
    }
  }

  app.prefLoaded = true;

  // The injected code, which is in the context of the BBO application, listens
  // for pref_update to update its copy of PREF.
  if (isChrome) {
    document.dispatchEvent(new CustomEvent("pref_update", { detail: pref }));
  } else {
    // Firefox will not allow the page script to access anything in the detail object
    // sent by the content script via CustomEvent unless you clone the event detail
    // into the document first using the Firefox-specific cloneInto() function.
    //
    // See https://stackoverflow.com/questions/18744224/
    // triggering-a-custom-event-with-attributes-from-a-firefox-extension
    let clonedPref = cloneInto(pref, document.defaultView);
    document.dispatchEvent(
      new CustomEvent("pref_update", { detail: clonedPref })
    );
  }

  // Now setup event listener to reload preferences if they change.
  browser.storage.onChanged.addListener(onPrefChange);
}

function onPrefChange(changes, areaName) {
  if (areaName === "local" && changes["pref"] !== undefined) {
    browser.storage.local.get("pref").then(onPrefUpdate);
  }
}

function onPrefUpdate(item) {
  pref = item.pref;

  if (isChrome) {
    document.dispatchEvent(
      new CustomEvent("pref_update", { detail: item.pref })
    );
  } else {
    // See comment above in onPrefLoad()
    let clonedPref = cloneInto(pref, document.defaultView);
    document.dispatchEvent(
      new CustomEvent("pref_update", { detail: clonedPref })
    );
  }
}

// Listen for user preference updates
document.addEventListener("pref_request", () => {
  console.info("BBO Helper: responding to a request for user preferneces");

  if (isChrome) {
    document.dispatchEvent(new CustomEvent("pref_update", { detail: pref }));
  } else {
    // See comment above in onPrefLoad()
    let clonedPref = cloneInto(pref, document.defaultView);
    document.dispatchEvent(
      new CustomEvent("pref_update", { detail: clonedPref })
    );
  }
});

// Listen for messages from the popup menu for menu items that invoke an action
// in the current tab supplied by this module.
browser.runtime.onMessage.addListener(function (msg) {
  if (msg.type !== "menu") {
    return;
  }

  switch (msg.action) {
    case "toggleCopyboard":
      copyboard("toggle");
      return;

    case "dd_bsol":
      analyze();
      return;

    case "createpbn":
      createpbn();
      return;

    case "toggleNameDisplay":
      toggleNameDisplay();
      return;

    case "exportstorage":
      exportstorage();
      return;

    case "importstorage":
      selectfile(importstorage);
      return;
  }
});

function isChromium() {
  // navigator.userAgentData.brands is the seemingly clean way because it includes
  // brands for both 'Chrome' (etc) and 'Chromium', however Firefox does not yet
  // implement navigator.userAgentData and it is not exposed in Chromium for
  // insecurely served pages, so provide a fallback mechanism.

  return navigator.userAgentData
    ? navigator.userAgentData.brands.some((data) => data.brand === "Chromium")
    : navigator.userAgent.search("Firefox") === -1;
}

// Both these objects are indexed by BBO handles. The first stores caches
// lookup from the background service (fullname, state, mps) and the second
// caches BBO information from <sc_user_profile> messages elements.
// Note: VAR not LET. Need visibility outside common.js
var realnames = {};
var bboprofiles = {};

// Full name of player on a VuGraph. This one is indexed by the player label.
var vgnames = {};

function realnameResponse(msg) {
  if (msg === undefined) {
    // Shouldn't happen but was happening during switchover to a service worker
    // for Manifest V3 compliance.
    console.error(
      "BBO Helper: realnameResponse() received undefined from service worker."
    );
  } else if (typeof msg.bbohandle === "object") {
    // Note typeof arrays is "object", a JavaScript stupidity.
    for (let i = 0; i < msg.bbohandle.length; i++) {
      if (msg.fail[i]) {
        realnames[msg.bbohandle[i]] = undefined;
        continue;
      }

      realnames[msg.bbohandle[i]] = {
        fullname: msg.fullname[i],
        state: msg.state[i],
        mp: msg.mp[i],
      };
    }
  }

  // Single BBO handle response.
  else if (msg.lookupfail) {
    // Note that lookup failed so that we don't try again.
    realnames[msg.bbohandle] = undefined;
  } else {
    realnames[msg.bbohandle] = {
      fullname: msg.fullname,
      state: msg.state,
      mp: msg.mp,
    };
  }
}

// BBO's seat order.
const seatletters = "SWNE";

const suitrank = "SHDC";
const suitclass = ["ss", "hs", "ds", "cs"];
const suitentity = ["&spades;", "&hearts;", "&diams;", "&clubs;"];

// TP suffix indicate the "text presentation" version that explicitly suppress the Emoji
// presentation that some downstream applications will otherwise convert the suit symbols to.
// '\uFE0E' is the Unicode text presentation selector.
const suitentityTP = suitentity.map((a) => {
  return a + "\uFE0E";
});
const suitHTMLclass = suitentityTP.map((a, ix) => {
  return `<span class="${suitclass[ix]}">` + a + "</span>";
});

// Black suits will be in foreground color unless user chooses to force them to be black.
const black = pref.suitForceBlack ? "black" : "";
const suit2color = [black, "red", "red", black];
const suit4color = ["#2c399f", "red", "#e86e23", "#40813f"];

// The TP suffixed version are the "text presentation" versions
const suitHTMLplain = new Array(4),
  suitHTML4color = new Array(4);
const suitHTMLplainTP = new Array(4),
  suitHTML4colorTP = new Array(4);

for (let i = 0; i < 4; i++) {
  suitHTML4color[
    i
  ] = `<span style="color: ${suit4color[i]}">${suitentity[i]}</span>`;
  suitHTML4colorTP[i] =
    `<span style="color: ${suit4color[i]}">` + suitentityTP[i] + "</span>";

  if (suit2color[i] === "") {
    suitHTMLplain[i] = suitentity[i];
    suitHTMLplainTP[i] = suitentityTP[i];
  } else {
    suitHTMLplain[
      i
    ] = `<span style="color: ${suit2color[i]}">${suitentity[i]}</span>`;
    suitHTMLplainTP[i] =
      `<span style="color: ${suit2color[i]}">` + suitentityTP[i] + "</span>";
  }
}

function sleep(ms) {
  // Invoke as 'await sleep(ms)'
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rtrim(s, n) {
  // Removes the last N characters from a string. Some version of SUBSTR or
  // SUBSTRING should do this... but they don't in JavaScript.
  return s.substr(0, s.length - n);
}

function zeroPadInt(n, places) {
  s = n.toString();
  if (s.length > places) {
    return s;
  }
  return s.padStart(places, "0");
}

function encodedSuitFix(s) {
  // Fixes a BBO issue where suit symbols are messed up in a LIN string downloaded
  // from BBO My Hands.

  return s.replace(/\u00E2\u2122[\u00A0\u00A3\u00A5\u00A6]/gi, suitlettersub);

  function suitlettersub(match) {
    // Note: the Unicode codepoints for the suit symnols are not consecutive
    // and do not exactly follow the bridge suit order.
    const suitletter = match.endsWith("\u00A0")
      ? "s"
      : match.endsWith("\u00A3")
      ? "h"
      : match.endsWith("\u00A5")
      ? "c"
      : "d";
    return "!" + suitletter;
  }
}

function doubleEncodedSuitFix(s) {
  // Fixes a BBO issue where suit symbols can end up doubly UTF-8 encoded
  // in the LIN string passed to the BBO Handviewer.

  // C2 A2 E2 84 A2 C2 A2 C2 Ax
  return s.replace(/%C3%A2%E2%84%A2%C2%A[0356]/gi, suitlettersub);

  function suitlettersub(match) {
    // Note: the Unicode codepoints for the suit symbols are not consecutive
    // and do not exactly follow the bridge suit order.
    const suitletter = match.endsWith("0")
      ? "s"
      : match.endsWith("3")
      ? "h"
      : match.endsWith("5")
      ? "c"
      : "d";
    return "!" + suitletter;
  }
}

function UTF8fix(s) {
  // JavaScript strings are UTF-16 but with BBO there are situations where the
  // UTF-16 string you have (e.g. a LIN string), is really the character code
  // equivalents of a UTF-8 string. decodeURIComponent(escape(s)) is the quick
  // and dirty solution but escape() is deprecated. So do it "right".
  const len = s.length;
  if (len === 0) {
    return s;
  }

  // Despite failing to represent other symbols as UTF-8, BBO does so for the suit
  // symbols (probably the result of downstream conversion). So undo this before
  // the check below.

  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const val = s.charCodeAt(i);
    if (val > 256) {
      return s;
    } // Not a UTF-8 string packed as UTF-16. Bail.
    u8[i] = val;
  }

  const decoder = new TextDecoder();
  return decoder.decode(u8);
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options; // 8 sec default

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  });

  clearTimeout(id);
  return response;
}

function bestAvailableName(bbohandle) {
  let lchandle = bbohandle.toLowerCase();

  // ACBL database is the best source of real names.
  if (realnames[lchandle]) {
    return realnames[lchandle].fullname;
  }

  if (!bboprofiles[lchandle]) {
    return bbohandle;
  }

  let bboname = bboprofiles[lchandle].name;

  // NAME field should always be present but guard against BBO changes.
  if (bboname === undefined) {
    return bbohandle;
  }

  bboname = bboname.trim();
  if (bboname === "" || bboname === "Private" || bboname === "private") {
    return bbohandle;
  }

  // User has some semblance of a real name in their BBO profile. Remove any
  // spurious white space and attempt to address capitalization issues.
  let parts = bboname.split(/\s+/);

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    // Fix obnoxiously fully capitalized names put ignore suffixes like III
    if (
      part.length > 1 &&
      part.match(/^[A-Z]+$/) !== null &&
      part.match(/^[IV]+$/) === null
    ) {
      part = part.toLowerCase();
    }

    // Capitalize first character of Latin alphabet names except for nobiliary particles.
    if (
      part.charAt(0) >= "a" &&
      part.charAt(0) <= "z" &&
      part !== "de" &&
      part !== "von" &&
      part !== "zu" &&
      part !== "of"
    ) {
      part = part.charAt(0).toUpperCase() + part.substr(1);
    }
    parts[i] = part;
  }

  // If only a single name is given in the BBO profile add the BBO handle for clarity.
  return parts.length === 1
    ? parts[0] + " (" + bbohandle + ")"
    : parts.join(" ");
}

async function boardhtml(d, inlineCSS, includeAll = false) {
  // inlineCSS (boolean) - If true, all styling will be inline CSS
  // includeAll (boolean) - Include auction, cardplay, timing information,
  //    double dummy table, contract, HCP, and links regardless of user
  //    preferences (used when generating session HTML)

  let cos;

  const seatlabels = seatLabels(d.name, d.isVugraph);

  const localize =
    pref.appBoardLocalization && app.lang !== "en" && d.handL !== undefined;
  let [west, north, east, south] = localize
    ? [d.handL[1], d.handL[2], d.handL[3], d.handL[0]]
    : d.deal.split(":");

  const suithtml = !inlineCSS
    ? suitHTMLclass
    : pref.suitFourColor
    ? suitHTML4colorTP
    : suitHTMLplainTP;

  const showTiming =
    (pref.boardShowTiming || includeAll) &&
    d.auctionTimes !== undefined &&
    d.playTimes !== undefined;

  const showDD =
    (pref.boardShowDoubleDummy || includeAll) && d.dd !== undefined;

  // Partial deals don't show the action, double dummy table + par contract,
  // the card play table, and the alert explanations, handviewer links, and
  // event time.
  const isFullDeal = d.deal.length === 67;
  const showAuction = (pref.boardShowAuction || includeAll) && isFullDeal;

  // Even if we are requested to show a table of the trick by trick card
  // play, it is only possible if the BBO Hand Viewer was invoked with the
  // 'lin' URL parameter because we can not read the internal state of the
  // BBO hand viewer or BBO application from the add-on. Also don't show the
  // card play if the hand ended before any tricks were played. Will lift
  // restriction of full deal later.
  const showPlay =
    (pref.boardShowPlay || includeAll) &&
    isFullDeal &&
    (d.cardplay !== undefined ||
      (d.lin !== undefined && d.lin.indexOf("pc|") !== -1));

  if (showPlay) {
    playHTML = cardhtml(d, showTiming, inlineCSS);
  }

  let showExplanations =
    (pref.boardShowExplanations || includeAll) && isFullDeal && d.alert;
  if (showExplanations) {
    let alert = new Array(d.alert.length);
    if (!pref.boardHideRobotExplanations) {
      alert = d.alert;
    } else {
      // Clear Robot alerts.
      let dix = seatletters.indexOf(d.dealer);

      for (let i = 0; i < d.alert.length; i++) {
        let ix = (dix + i) % 4;
        alert[i] = d.name[ix] === "Robot" && d.alert[i] ? "" : d.alert[i];
      }
    }

    // See if there were any explained bids.
    showExplanations = false;
    for (let i = 0; i < d.alert.length; i++) {
      if (alert[i] !== undefined && alert[i].trim() !== "") {
        showExplanations = true;
        break;
      }
    }
    if (showExplanations) {
      explainHTML = explainhtml(d.auction, alert, showPlay, inlineCSS);
    }
  }

  // Need the approximate Auction Box width so that we can set padding-left
  // For North and South hands to roughly center them while keeping them left aligned
  // which they wouldn't be if we simply centered each on in its <td> element. The
  // AuctionBox with depends whether we use full seatnames, Pass (or P), etc and is
  // best computed in auctionhtml();
  let auctionBoxHTML, auctionBoxWidthEm;
  if (showAuction) {
    [auctionBoxHTML, auctionBoxWidthEm] = auctionhtml(d, showTiming, inlineCSS);
  }

  // Right padding for West and left padding for East hand
  const ewpadding = "0.7em";

  let nspadding = (auctionBoxWidthEm - 4) / 2;
  nspadding = nspadding > 0 ? nspadding.toFixed(2) + "em" : "0";

  // Include the board #, deal, auction, and contract, and LIN string in custom data-
  // attributes of the outer <div>. This is the HTML5 solution for including custom
  // attributes that are fully valid. The data- attributes allow for programmatic parsing.
  let dataAttribs = `data-board="${d.bstr}" data-deal="${d.deal}"`;
  if (d.auctionstr !== undefined) {
    dataAttribs += ` data-auction="${d.auctionstr}"`;
  }

  let data_contract =
    d.contractLevel === -1
      ? "Incomplete Auction"
      : d.contractLevel === 0
      ? "Passed Out"
      : d.contractLevel + d.contractDenom + d.doubled + " " + d.declarer;
  dataAttribs += ` data-contract="${data_contract}"`;

  if (d.lin) {
    // Don't need full uglification of encodeURIComponent() for the data- attribute.
    const qlin = d.lin.replaceAll('"', "&amp;");
    dataAttribs += ` data-lin="${qlin}"`;
  }

  // Include a class for manipulation through CSS of the HTML document into which the
  // code snipped is included. Note: Inline styling can be overridden using !important
  // See https://cssdeck.com/blog/how-to-override-inline-css-styles/
  // https://www.ghacks.net/2015/02/04/select-and-copy-multiple-text-bits-in-firefox-in-one-go/
  cos = "";
  if (inlineCSS) {
    let dvstyle = "padding: 0.2em; break-inside: avoid";
    if (pref.boardIncludeBorder) {
      dvstyle += "; border: 1px solid #777";
    }
    cos = `style="${dvstyle}" `;
  }
  let html = `<div ${cos}class="bh-board" ${dataAttribs}>` + "\n";

  html += "<table><tbody>";

  // Board number with vulnerability indicator
  html += "<tr>";

  if (isFullDeal || pref.boardPartialShowBoardNumber) {
    // When showing a partial board, don't show the vulnerability indicators.
    let vul = pref.boardPartialShowBoardNumber ? "None" : d.vul;
    html += numvulhtml(d.bstr, vul) + "\n";
  } else {
    html += "<td></td>";
  }

  // North hand
  html +=
    `<td class="bh-north" style="padding-left: ${nspadding}">` +
    handhtml(north, seatlabels[2], inlineCSS) +
    "</td>" +
    "\n";

  // Strip off the day (e.g. 'Sun') at the start.
  let datehtml =
    d.datestr === undefined || !pref.boardShowDateTime
      ? ""
      : '<span style="font-size: 80%">' + d.datestr.substr(4) + "</span><br>";

  if (!isFullDeal || (!pref.boardShowLinks && !includeAll)) {
    html += `<td>${datehtml}</td>`;
  } else {
    // Matchpoint percentage or IMP gain/loss. (Note: Raw score, e.g. +450 is
    // shown with the contract, downstream.)
    let scorehtml = "";
    if (d.score !== undefined) {
      if (d.score.endsWith("%") || d.score.startsWith("A")) {
        // Matchpoints or some type of average
        scorehtml = d.score;
      } else {
        // Explicit + sign for IMPs won, for clarity.
        scorehtml = (d.score > 0 ? "+" : "") + d.score + " IMPS";
      }
      const cos = inlineCSS
        ? 'style="margin-bottom: 0.3em"'
        : 'class="bh-score"';
      scorehtml = `<div ${cos}>` + scorehtml + "</div>";
    }

    // Add Traveller, BBO Handviewer and BSOL links.
    let target = pref.boardLinksTargetBlank ? ' target="_blank"' : "";

    const lin = d.lin !== undefined ? d.lin : deal2lin(d, seatlabels);
    // It's kind of ugly to replace all the | symbols with %7C but technically | isn't
    // a valid character in a URL, though browsers usually accept it and it doesn't
    // have a special meaning (i.e. isn't reserved)
    const encodedLIN = encodeURIComponent(lin);

    let HVurl =
      "https://www.bridgebase.com/tools/handviewer.html?lin=" + encodedLIN;
    let BSOLurl =
      "https://dds.bridgewebs.com/bsol2/ddummy.htm" + "?lin=" + encodedLIN;

    if (d.title !== undefined) {
      // & needs to be escaped because it is inside HTML.
      BSOLurl += "&amp;title=" + encodeURIComponent(d.title);
    }

    let linkhtml = '<div class="bh-links">' + "\n";
    if (d.travellerURL !== undefined) {
      let travellerURL = d.travellerURL.replaceAll("&", "&amp;");
      linkhtml += `<a href="${travellerURL}"${target}>Traveller</a><br>` + "\n";
    }
    linkhtml +=
      `<a href="${HVurl}"${target}>BBO Viewer</a><br>` +
      "\n" +
      `<a href="${BSOLurl}"${target}>Bridge Solver</a>` +
      "\n" +
      "</div>";

    // When we have both a score and the traveller link, it looks better to
    // align to the top of the <td>, otherwise center vertically.
    const alignTop = d.score !== undefined && d.travellerURL !== undefined;
    let style =
      "padding-left: 0.7em; vertical-align: " + (alignTop ? "top" : "middle");
    let classList = "bh-score-links " + (alignTop ? "vtop" : "vmid");

    cos = inlineCSS ? `style="${style}"` : `class="${classList}"`;
    html += `<td ${cos}>${scorehtml}${datehtml}${linkhtml}</td>` + "\n";
  }

  // Create a <td> that spans all three rows if we are showing a play table.
  if (showPlay) {
    html +=
      '<td rowspan="3" style="padding-left: 1.5em">' +
      "\n" +
      playHTML +
      "</td>";
  }

  // Create a <td> that spans all three rows if we are showing explanations
  if (showExplanations) {
    let padding = showPlay ? "0.6em" : "1em";
    let style = `vertical-align: middle; padding-left: ${padding}`;
    html +=
      `<td rowspan="3" class="bh-explanations" style="${style}">` +
      explainHTML +
      "</td>";
  }

  html += "</tr>" + "\n\n";

  style = `vertical-align: middle; padding-right: ${ewpadding}`;
  html +=
    "<tr>" +
    `<td class="bh-west" style="${style}">` +
    handhtml(west, seatlabels[1], inlineCSS) +
    "</td>" +
    "\n";

  if (showAuction && pref.auctionPosition === "center") {
    html += '<td style="padding: 0">' + "\n";
    html += auctionBoxHTML;
    html += "</td>" + "\n";
  } else {
    html += "<td></td>";
  }

  // East hand
  style = `vertical-align: middle; padding-left: ${ewpadding}`;
  html +=
    `<td class="bh-east" style="${style}">` +
    handhtml(east, seatlabels[3], inlineCSS) +
    "</td></tr>" +
    "\n\n";

  html += "<tr>";

  // Double dummy information (or HCP if not including double dummy)
  if (showDD) {
    let [ddtablehtml, parhtml] = ddhtml(d.dd, "Board", inlineCSS);
    html +=
      '<td><div class="bh-dd-par">' +
      ddtablehtml +
      "\n" +
      parhtml +
      "</div></td>";
  } else if (isFullDeal && (pref.boardShowHCP || includeAll)) {
    html += "<td>" + hcphtml(d.hcp, inlineCSS) + "</td>";
  } else {
    html += "<td></td>";
  }
  html += "\n";

  html +=
    `<td class="bh-south" style="padding-left: ${nspadding}">` +
    handhtml(south, seatlabels[0], inlineCSS) +
    "</td>" +
    "\n";

  const showContract = isFullDeal
    ? pref.boardShowContract || includeAll
    : pref.boardPartialShowContract;

  if (!showContract) {
    html += "<td></td>";
  } else {
    let showHCP = isFullDeal && (pref.boardShowHCP || includeAll) && showDD;

    // Center contract (and optional raw score) they are the only thing(s) in the cell;
    // otherwise leave a little space between it and the HCP diagram.
    let cos = inlineCSS
      ? 'style="text-align: center; vertical-align: middle"'
      : 'class="bh-td-contract"';
    html += `<td ${cos}>`;

    // Sometimes have the raw score.
    const haveRawScore = d.rawScore !== undefined;

    if (haveRawScore) {
      // Make positive score (for your user's side) explicit.
      const rawScore = (d.rawScore > 0 ? "+" : "") + d.rawScore;

      const style = "font-size: 120%; font-weight: bold; margin-bottom: 0.2em";
      const classList = "bh-rawscore sps";

      cos = inlineCSS ? `style="${style}"` : `class="${classList}"`;
      html += `<div ${cos}>` + rawScore + "</div>";
    }

    let contracthtml;
    if (d.contractLevel === -1) {
      contracthtml = "Incomplete<br>Auction";
    } else if (d.contractLevel === 0) {
      contracthtml = "Passed<br>Out";
    } else {
      const ix = suitrank.indexOf(d.contractDenom);
      // localize ? app.locale.nt
      const denomtxt =
        ix !== -1 ? suithtml[ix] : localize ? app.locale.nt : "NT";
      const declarertxt = !localize
        ? d.declarer
        : app.locale.seatLetters.charAt(seatletters.indexOf(d.declarer));

      contracthtml = d.contractLevel + denomtxt;
      contracthtml += d.doubled + " " + declarertxt;
    }

    let style = "font-size: 120%; font-weight: bold";
    let classList = "bh-contract";

    if (showHCP) {
      // Add appropriate vertical space before HCP table.
      style += "; margin-bottom: " + (haveRawScore ? "0.2em" : "0.5em");
      classList += " " + (haveRawScore ? "sps" : "spl");
    }

    cos = inlineCSS ? `style="${style}"` : `class="${classList}"`;
    html += `<div ${cos}>` + contracthtml + "</div>";

    // Drop HCP table diagram below the contract if the double dummy table
    // displaced it from its default location at the bottom left.
    if (showHCP) {
      html += hcphtml(d.hcp, inlineCSS);
    }

    html += "</td>";
  }
  html += "</tr>" + "\n";

  html += "</tbody></table>";
  html += "</div>";

  return html;
}

function numvulhtml(bstr, vul) {
  // Units of em (for 200% font size)
  let bwidth = bstr.length <= 2 ? 1.2 : 1.8;
  let bheight = 1.2;
  let bpadding = 0.16;

  let vulsize = 0.5;
  let fontsize = 200;

  // display: inline-block so that width and height work.
  const bstyle =
    `text-align: center; vertical-align: middle; ` +
    "background-color: white; border: solid 1px black; display: inline-block; " +
    `width: ${bwidth}em; height: ${bheight}em; padding: ${bpadding}em`;

  let bnhtml = `<div class="bh-bnum" style="${bstyle}">${bstr}</div>`;

  if (vul === "None") {
    const tstyle = `margin: auto; text-align: center; font-size: ${fontsize}%`;
    return `<td style="${tstyle}">${bnhtml}</td>`;
  }

  let tstyle =
    "display: flex; justify-content: center; align-items: center; " +
    `font-size: ${fontsize}%`;

  if (vul === "NS") {
    // Final 0.06 compensates for width of border around board number box
    let w = bwidth + bpadding * 2 + 0.06;
    let h = bheight + bpadding * 2 + vulsize * 2;
    let style =
      `background-color: red; width: ${w}em; height: ${h}em; ` +
      "display: flex; justify-content: center; align-items: center";

    return (
      `<td style="${tstyle}">` +
      `<div style="${style}">` +
      bnhtml +
      "</div></td>"
    );
  }

  if (vul === "EW") {
    // Final 0.06 compensates for height of border around board number box
    let h = bheight + bpadding * 2 + 0.06;
    let w = bwidth + bpadding * 2 + vulsize * 2;
    let style =
      `background-color: red; width: ${w}em; height: ${h}em; ` +
      "display: flex; justify-content: center; align-items: center";

    return (
      `<td style="${tstyle}">` +
      `<div style="${style}">` +
      bnhtml +
      "</div></td>"
    );
  }

  if (vul === "All") {
    let h = bheight + bpadding * 2 + vulsize * 2;
    let w = bwidth + bpadding * 2 + vulsize * 2;
    let style =
      `background-color: red; width: ${w}em; height: ${h}em; ` +
      "display: flex; justify-content: center; align-items: center";

    return (
      `<td style="${tstyle}">` +
      `<div style="${style}">` +
      bnhtml +
      "</div></td>"
    );
  }

  console.log(
    "BBO Helper: numvulhtml(): vul must be 'None', 'NS', 'EW' or 'All'"
  );
  return "";
}

function handhtml(hd, pname, inlineCSS) {
  let html = "";
  let cos; // COS (Class or Style)

  let suitcolor = pref.suitFourColor ? suit4color : suit2color;

  if (pref.boardIncludeNames) {
    cos = inlineCSS
      ? 'style="background-color: #d3d3d3; padding: 0 0.2em 0 0.2em"'
      : 'class="pname"';
    html += `<span ${cos}>` + pname + "</span><br>";
  }

  html += inlineCSS
    ? '<span style="letter-spacing: 0.2em">'
    : '<span class="hand">';

  let suits = hd.split(".");
  for (let i = 0; i < 4; i++) {
    // 1em is wide enough for the heart symbol, the widest suit symbol in most fonts.
    if (inlineCSS) {
      let style = "display: inline-block; width: 1em; text-align: center";
      if (suitcolor[i] !== "") {
        style += `; color: ${suitcolor[i]}`;
      }
      cos = `style="${style}"`;
    } else {
      cos = `class="hsym ${suitclass[i]}"`;
    }

    // Use text presentation version. This should prevent later programs (say Microsoft
    // Outlook) from converting the suit symbols to emoji style presentation.
    html += `<span ${cos}>` + suitentityTP[i] + "</span>";
    if (suits[i].length) {
      if (!pref.cardUse10) {
        html += suits[i];
      } else {
        let suit10sub = inlineCSS
          ? suits[i].replace("T", '<span style="letter-spacing: 0">1</span>0')
          : suits[i].replace("T", '<span class="ten">1</span>0');
        html += suit10sub;
      }
    } else {
      // Void in suit.
      if (pref.handVoidmdash) {
        html += "&mdash;";
      }
    }
    if (i < 3) {
      html += "<br>";
    }
  }
  html += "</span>";
  return html;
}

function timecolor(tm, inlineCSS) {
  // Flag certain time situations with background colors. TM is in seconds
  if (tm <= pref.timingInstantAction) {
    return inlineCSS ? "#aaffff" : "insta";
  } else if (tm >= pref.timimgLongBIT) {
    return inlineCSS ? "#ff7f7f" : "longBIT";
  } else if (tm >= pref.timingBIT) {
    return inlineCSS ? "#ffd47f" : "BIT";
  }
}

function auctionhtml(d, showTiming, inlineCSS) {
  const bboStyling = pref.auctionBBOstyling;
  const bboVulColor = "#cb0000";
  const bboAlertColor = "#ffce00";
  const bboAuctionBoxColor = "#aadddd"; // BBO uses #99cccc

  const localize = pref.appBoardLocalization && app.lang !== "en";

  // Non-contract calls
  const txtPass = pref.auctionShortCalls
    ? "P"
    : localize
    ? app.locale.pass
    : "Pass";
  const txtDouble = pref.auctionShortCalls
    ? "X"
    : localize
    ? app.locale.dbl
    : "Dbl";
  const txtRedouble = pref.auctionShortCalls
    ? "XX"
    : localize
    ? app.locale.rdbl
    : "Rdbl";

  const suithtml = !inlineCSS
    ? suitHTMLclass
    : pref.suitFourColor
    ? suitHTML4colorTP
    : suitHTMLplainTP;

  const seatnames = localize
    ? pref.auctionSeatLetters
      ? [
          app.locale.seatLetters.charAt(1),
          app.locale.seatLetters.charAt(2),
          app.locale.seatLetters.charAt(3),
          app.locale.seatLetters.charAt(0),
        ]
      : [
          app.locale.seatName[1],
          app.locale.seatName[2],
          app.locale.seatName[3],
          app.locale.seatName[0],
        ]
    : pref.auctionSeatLetters
    ? ["W", "N", "E", "S"]
    : ["West", "North", "East", "South"];

  let style = "text-align: center; border-collapse: collapse";
  if (bboStyling) {
    style +=
      "; border: 1px solid #aaa; background-color: " + bboAuctionBoxColor;
  }

  let classList = "bh-auction";
  if (showTiming) {
    classList += " " + "bh-auctiontm";
  }

  let html = `<table class="${classList}" style="${style}">` + "\n";
  // Auction table begins with West (BBO convention).
  let colwidth = !pref.auctionSeatLetters
    ? 2.6
    : !pref.auctionShortCalls
    ? 2
    : 1.6;
  let wstyle = `width: ${colwidth}em`;

  // Write header row of the Auction table.
  html += "<thead><tr>";
  let colspan = showTiming ? ' colspan="2"' : "";
  if (!bboStyling) {
    for (let i = 0; i < 4; i++) {
      html += `<th style="${wstyle}"${colspan}>` + seatnames[i] + "</th>";
    }
  } else {
    let styleNV = wstyle + "; " + "background-color: white";
    let styleV =
      wstyle +
      "; " +
      "background-color: " +
      bboVulColor +
      "; " +
      "color: white";
    let styleEW = d.vul === "All" || d.vul === "EW" ? styleV : styleNV;
    let styleNS = d.vul === "All" || d.vul === "NS" ? styleV : styleNV;
    html +=
      `<th style="${styleEW}"${colspan}>` +
      seatnames[0] +
      "</th>" +
      `<th style="${styleNS}"${colspan}>` +
      seatnames[1] +
      "</th>" +
      `<th style="${styleEW}"${colspan}>` +
      seatnames[2] +
      "</th>" +
      `<th style="${styleNS}"${colspan}>` +
      seatnames[3] +
      "</th>";
  }
  html += "</tr></thead>";
  html += "<tbody>" + "\n";

  // Figure out number of empty <td> elements before dealer.
  let nEmpty =
    d.dealer === "W" ? 0 : d.dealer === "N" ? 1 : d.dealer === "E" ? 2 : 3;
  // Need the empty timing <td> elements to have class="tma" so that toggling timing
  // display in session HTML listing works correctly.
  html +=
    "<tr>" +
    (showTiming ? '<td></td><td class="tma"></td>' : "<td></td>").repeat(
      nEmpty
    );

  // Hide final passes unless we are showing the timing. But don't hide fewer than
  // three final passes so that incomplete auctions are indicated as such. Also don't
  // hide final passes if hand is passed out.
  let lix = d.auction.length - 1;
  if (!showTiming && pref.auctionHideFinalPasses && d.auction.length > 3) {
    if (
      d.auction[lix - 2] === "P" &&
      d.auction[lix - 1] === "P" &&
      d.auction[lix] === "P" &&
      !(lix == 3 && d.auction[0] === "P")
    ) {
      lix -= 3;
    }
  }

  let callhtml;

  const astyle = "background-color: " + bboAlertColor;
  const cosAlert = " " + (inlineCSS ? `style="${astyle}"` : 'class="alert"');

  let ipos = nEmpty; // Position in current row of auction table
  for (let i = 0; i <= lix; i++) {
    if (ipos == 4) {
      // Need to start a new row in the auction table
      html += "</tr>" + "\n" + "<tr>";
      ipos = 0;
    }
    let call = d.auction[i];
    if (call === "P") {
      callhtml = txtPass;
    } else if (call === "X") {
      callhtml = txtDouble;
    } else if (call === "XX") {
      callhtml = txtRedouble;
    } else {
      const denom = call.charAt(1);
      const level = call.charAt(0);
      if (denom === "N") {
        callhtml =
          level +
          (showTiming ? "N" : localize ? app.locale.nt : pref.auctionTextNT);
      } else {
        const ix = suitrank.indexOf(denom);
        callhtml = level + suithtml[ix];
      }
    }

    let tdhtml = "<td";
    if (d.alert && d.alert[i]) {
      if (bboStyling) {
        tdhtml += cosAlert;
      } else callhtml += "!";
    }

    html += tdhtml + ">" + callhtml + "</td>";

    // Bump now because of CONTINUE in loop below when timing is missing.
    ipos++;

    if (showTiming) {
      let ms = d.auctionTimes[i];

      // Color here is either an actual color (for inline CSS) or a class.
      let tmstr, color, tmHTML;

      // Zero is a special value that means we don't have timing information.
      // "undefined" is possible from BBO Helper 1.3 forward where timing
      // is saved even if we do not witness end of the bidding and cad play.
      if (ms === 0 || ms === undefined) {
        html += inlineCSS
          ? '<td style="border-left: none"></td>'
          : '<td class="tma"></td>';
        continue;
      }

      // Longer than 552.955 seconds (nearly 11 minutes!)
      else if (ms === 655350) {
        tmstr = "&infin;";
        color = inlineCSS ? "red" : "infinity";
      } else {
        // Normal case
        let sec = ms / 1000;
        tmstr = sec < 9.5 ? sec.toFixed(1) : sec.toFixed(0);

        // Basic styling for timing information.
        color = timecolor(sec, inlineCSS);
      }

      // Basic styling for timing information.
      const style =
        "border-left: none; margin-left: 0; text-align: left; " +
        "font-size: 65%; vertical-align: top";
      cos = inlineCSS ? `style="${style}"` : 'class="tma"';

      if (color === undefined) {
        tmHTML = tmstr;
      } else {
        let tmcos = inlineCSS
          ? `style="background-color: ${color}"`
          : `class="${color}"`;
        tmHTML = `<span ${tmcos}>${tmstr}</span>`;
      }

      html += `<td ${cos}>` + tmHTML + "</td>";
    }
  }

  // Add final empty <td> elements on row (if any).
  const nEmptyCalls = (4 - ipos) % 4;
  if (nEmptyCalls !== 0) {
    let rephtml = "<td></td>";
    if (showTiming) {
      rephtml += inlineCSS
        ? '<td style="border-left: none"></td>'
        : '<td class="tma"></td>';
    }
    html += rephtml.repeat(nEmptyCalls);
  }
  html += "</tr>" + "\n";
  html += "</tbody>" + "\n" + "</table>" + "\n";

  return [html, 4 * colwidth];
}

function cardhtml(d, showTiming, inlineCSS) {
  // Generate HTML for trick by trick card play table.

  let cos;
  let cardplay = d.cardplay ? d.cardplay : lin2cardplay(d.lin);
  let nclaimed =
    d.nclaimed !== undefined
      ? d.nclaimed
      : d.lin === undefined
      ? undefined
      : lin2claimed(d.lin);

  const suithtml = !inlineCSS
    ? suitHTMLclass
    : pref.suitFourColor
    ? suitHTML4colorTP
    : suitHTMLplainTP;

  const localize =
    pref.appBoardLocalization && app.lang !== "en" && d.handL !== undefined;

  const seatletters = localize ? app.locale.seatLetters : "SWNE";
  const seatnames = localize
    ? app.locale.seatName
    : ["South", "West", "North", "East"];

  // rotation to apply to card table. 0 means South is first column,
  // 1 means West is first column, etc.
  ixr = 1;

  const styleTable =
    "text-align: center; padding: 0; border-collapse: collapse; " +
    "border: solid; border-width: 1px; border-color: #808080";
  cos = inlineCSS ? ` style="${styleTable}"` : "";

  let classList = "bh-cardplay";
  if (showTiming) {
    classList += " " + "bh-cardtm";
  }

  let html = `<table class="${classList}"${cos}>` + "\n";

  const styleTableHead = "font-weight: bold; background-color: #c0c0c0";
  cos = inlineCSS ? ` style="${styleTableHead}"` : "";

  html += "<thead" + cos + ">" + "<tr>";

  for (let i = 0; i < 4; i++) {
    let colhead = showTiming
      ? '<th style="width: 3em" colspan="2">' + seatnames[(i + ixr) % 4]
      : '<th style="width: 2em">' + seatletters.charAt((i + ixr) % 4);

    html += colhead + "</th>";
  }
  html += "</tr></thead>" + "\n";
  html += "<tbody>" + "\n";

  // HTML table order (not BBO order)
  const seatTimeTotals = [0, 0, 0, 0];

  for (let i = 0; i < cardplay.length; i += 4) {
    // Cards played on this trick by South, West, North, East (BBO order)
    // respectively.
    let cd = new Array(4);
    let leadseat = d.whohas[cardplay[i]];
    cd[d.whohas[cardplay[i]]] = cardplay[i];
    if (i + 1 < cardplay.length) {
      cd[d.whohas[cardplay[i + 1]]] = cardplay[i + 1];
    }
    if (i + 2 < cardplay.length) {
      cd[d.whohas[cardplay[i + 2]]] = cardplay[i + 2];
    }
    if (i + 3 < cardplay.length) {
      cd[d.whohas[cardplay[i + 3]]] = cardplay[i + 3];
    }

    html += "<tr>";
    for (let j = 0; j < 4; j++) {
      let jr = (j + ixr) % 4; // BBO seat index, i.e. South = 0
      if (cd[jr] === undefined) {
        // This would be on the last trick of a hand not fully played out.
        html += "<td></td>";
        if (showTiming) {
          html += inlineCSS
            ? '<td style="border-left: none"></td>'
            : '<td class="tm"></td>';
        }
        continue;
      }
      let suit = cd[jr].charAt(0);

      ix = suit === "S" ? 0 : suit === "H" ? 1 : suit === "D" ? 2 : 3;
      cos = showTiming
        ? inlineCSS
          ? "border-right: none; margin-right: 0"
          : "cd"
        : "";

      if (jr === leadseat) {
        if (cos !== "") {
          cos += inlineCSS ? "; " : " ";
        }
        if (inlineCSS) {
          cos += "background-color: #ccffcc";
        } else {
          cos += "leader";
        }
      }

      if (cos !== "") {
        cos = " " + (inlineCSS ? "style" : "class") + `="${cos}"`;
      }

      let cardrank = cd[jr].charAt(1);
      if (localize) {
        let ih = "JQKA".indexOf(cardrank);
        if (ih !== -1) {
          cardrank = app.locale.honorLetters.charAt(ih);
        }
      }

      html += "<td" + cos + ">" + suithtml[ix] + cardrank + "</td>";

      if (showTiming) {
        let cardIndex = i + ((jr + 4 - leadseat) % 4);
        let ms = d.playTimes[cardIndex];
        if (ms !== undefined) {
          seatTimeTotals[j] += ms;
        }

        // Color here is either an actual color (for inline CSS) or a class.
        let tmstr, color, tmHTML;

        // Zero is a special value that means we don't have timing information
        // because we joined a board part way through. "undefined" is possible
        // from BBO Helper 1.3 forward where timing is saved even if we do not
        // witness end of the bidding and cad play.
        if (ms === 0 || ms === undefined) {
          html += inlineCSS
            ? '<td style="border-left: none"></td>'
            : '<td class="tm"></td>';
          continue;
        }

        // Longer than 552.955 seconds (nearly 11 minutes!)
        else if (ms === 655350) {
          tmstr = "&infin;";
          color = inlineCSS ? "red" : "infinity";
        } else {
          // Normal case.
          let sec = ms / 1000;
          tmstr = sec < 9.5 ? sec.toFixed(1) : sec.toFixed(0);

          color = timecolor(sec, inlineCSS);
        }

        // Basic styling for timing information.
        const style =
          "border-left: none; margin-left: 0; text-align: left; " +
          "font-size: 70%; vertical-align: 100%";
        cos = inlineCSS ? `style="${style}"` : 'class="tm"';

        if (color === undefined) {
          tmHTML = tmstr;
        } else {
          let tmcos = inlineCSS
            ? `style="background-color: ${color}"`
            : `class="${color}"`;
          tmHTML = `<span ${tmcos}>${tmstr}</span>`;
        }

        html += `<td ${cos}>` + tmHTML + "</td>";
      }
    }
    html += "</tr>" + "\n";
  }

  if (showTiming) {
    // Include row of seat time totals for each seat.
    const style = "border: solid; border-width: 1px; border-color: #808080";
    cos = inlineCSS ? `style="${style}"` : 'class="timesum"';
    html += `<tr ${cos}>`;
    for (let j = 0; j < 4; j++) {
      html +=
        '<td colspan="2">' + (seatTimeTotals[j] / 1000).toFixed(1) + "</td>";
    }
    html += "</tr>";
  }

  if (nclaimed !== undefined) {
    // Indicate number of tricks claimed.
    const style = "border: solid; border-width: 1px; border-color: #808080";
    cos = inlineCSS ? `style="${style}"` : 'class="claim"';
    let ncols = showTiming ? 8 : 4;
    html +=
      `<tr ${cos}><td colspan="${ncols}">` +
      nclaimed +
      " Tricks Claimed" +
      "</td></tr>";
  }

  html += "</tbody></table>" + "\n";

  return html;
}

function rshtml() {
  console.log("in rshtml");
  let html = '<div style="">NS Leg : 40 </div>';
  html += '<div style="">EW Leg : 0 </div>';
  html += '<div style="">NS Vul : FALSE </div>';
  html += '<div style="">EW Vul : TRUE </div>';
  html += '<div style="">Rubber Score : 360-100 </div>';
  html += '<div style="">Total Score : 1300-560 </div>';
  return html;
}

function ddhtml(dd, mode, inlineCSS) {
  // Generate HTML for double dummy table and display of the optimal contract(s)
  // and optimal score.

  // MODE - 'Board' means output is for copy-and-paste aid board HTML. 'History'
  //        means request is for display in the History screen; 'Handviewer' means
  //        request is for display in the BBO Hand Viewer.

  const localize =
    (pref.appBoardLocalization || mode === "History") && app.lang !== "en";

  const seatorder = "NSEW"; // BSOL double dummy table order
  const seatorderL = !localize
    ? seatorder
    : app.locale.seatLetters[2] +
      app.locale.seatLetters[0] +
      app.locale.seatLetters[3] +
      app.locale.seatLetters[1];

  const textNT = localize ? app.locale.nt : pref.auctionTextNT;

  const suithtml = !inlineCSS
    ? suitHTMLclass
    : pref.suitFourColor
    ? suitHTML4colorTP
    : suitHTMLplainTP;

  let style = "text-align: center; border-collapse: collapse; padding: 0; ";
  // Space is tight in the History screen, so minimize white space at bottom.
  style += "margin-bottom: " + (mode === "History" ? "0em" : "0.4em");

  if (mode === "Board") {
    style += "; font-size: 60%";
  }
  let html =
    `<table class="bh-dd" style="${style}">` +
    "\n" +
    '<thead><tr style="font-weight: bold"><td style="width: 1.2em"></td>';
  let borderWidth = mode === "Board" ? "1px" : "2px";

  // Table runs from lowest denomination (clubs) to highest.
  for (let i = 3; i >= 0; i--) {
    html += '<td style="width: 1.8em">';
    if (inlineCSS) {
      // In the History pane and Handviewer ignore the four color suit preference
      // because everything provided by BBO is two color.
      html +=
        '<span style="font-size: 120%">' +
        (mode === "Handviewer" || mode === "History"
          ? suitHTMLplainTP[i]
          : suithtml[i]) +
        "</span>";
    } else {
      html += `<span class="${suitclass[i]}">` + suitentityTP[i] + "</span>";
    }
    html += "</td>";
  }
  html +=
    '<td style="width: 1.8em">' + textNT + "</td>" + "</tr></thead>" + "\n";
  html += "<tbody>";

  // Loop over seats
  let tdstr;
  let ddcos = inlineCSS
    ? `style="border: ${borderWidth} solid #444"`
    : 'class="dd"';
  for (let j = 0; j < 4; j++) {
    html += "<tr>";
    html += inlineCSS
      ? '<td style="border: none"><b>' + seatorderL.charAt(j) + "</b></td>"
      : '<td class="ddseat">' + seatorder.charAt(j) + "</td>";
    // BSOL dd tricks string is ordered from high denomination to lowest
    // but table runs from lowest denomination (clubs) to highest.
    for (let i = 4; i >= 0; i--) {
      let ntricks = parseInt(dd.tr.charAt(j * 5 + i), 16);
      if (pref.appDoubleDummyTricks) {
        tdstr = ntricks;
      } else {
        tdstr = ntricks > 6 ? ntricks - 6 : "-";
      }

      html += `<td ${ddcos}>` + tdstr + "</td>";
    }
    html += "</tr>" + "\n";
  }

  html += "</tbody></table>";

  // Now insert par score and par contract.

  let parScoreText, parContractText;
  if (dd.sNS == 0) {
    // One in about a million deals is a par zero deal where no seat can make any
    // contract double dummy
    parScoreText = dd.sNS;
    parContractText = "Pass Out";
  } else if (dd.sEW === undefined) {
    // Typical situation. Par is same regardless of which side starts the bidding.
    parScoreText = dd.sNS;
    parContractText = parcontracts(dd.cNS, dd.tr);
  } else {
    // Rather rare hot situation. Par depends on which side starts the bidding.
    const NStext = seatorderL.substr(0, 2);
    const EWtext = seatorderL.substr(2, 2);
    parScoreText = NStext + ": " + dd.sNS + " " + EWtext + ": " + dd.sEW;
    parContractText =
      NStext +
      ": " +
      parcontracts(dd.cNS, dd.tr) +
      " " +
      EWtext +
      ": " +
      parcontracts(dd.cEW, dd.tr);
  }

  // For the copy-and-paste aid and session HTML, do not include the 'Par: ' in front
  // of the contract list to save real estate.
  let parhtml =
    "Zach Score: " +
    parScoreText +
    "<br>" +
    (mode === "Board" ? "" : "Par: ") +
    parContractText;

  parhtml = inlineCSS
    ? "<strong>" + parhtml + "</strong>"
    : '<span class="par">' + parhtml + "</span>";

  return [html, parhtml];

  function parcontracts(str, tr) {
    let html = "";
    let contracts = str.split(",");
    let prevSeats;

    for (let i = 0; i < contracts.length; i++) {
      let [seats, c] = contracts[i].split(" ");

      // Inelegant but reasonably efficient approach that prioritizes most likely
      // 'NS' and 'EW' first.
      const seatsLocalized = !localize
        ? seats
        : seats === "NS"
        ? seatorderL.substr(0, 2)
        : seats === "EW"
        ? seatorderL.substr(2, 2)
        : seatorderL.charAt(seatorder.indexOf(seats));

      if (i) {
        html += ", ";
      }
      if (prevSeats !== seats) {
        html += seatsLocalized + " ";
        prevSeats = seats;
      }

      // Handle contracts like '45S' or '123H' or even '1234C' which indicate that
      // it is enough to bid the lowest level indicated, i.e opps can't sacrifice
      // over it, but highest number can be made.
      let ix = 0;
      while (c.charCodeAt(ix + 1) >= 49 && c.charCodeAt(ix + 1) <= 55) {
        ix++;
      }

      let denom = c.charAt(ix + 1);
      let ixrank = suitrank.indexOf(denom);
      let level = c.charAt(0);
      html += level;
      html += ixrank === -1 ? textNT : suithtml[ixrank];
      if (ix) {
        html += "+" + ix.toString();
      }
      if (c.charAt(2) === "x") {
        // Sacrifice contract, doubled of course, double dummy.
        html += "x";
        // Figure out how many tricks down the sacrifice is.
        let seatix = seatorder.indexOf(seats.charAt(0));
        let ddtricks = parseInt(tr.charAt(seatix * 5 + ixrank + 1), 16);
        html += "-" + (6 + parseInt(level) - ddtricks).toString();
      }
    }
    return html;
  }
}

function hcphtml(hcp, inlineCSS) {
  // Generate HTML for the HCP table.
  let html = '<table class="bh-hcp" style="margin: auto">';

  const tstyle = "font-size: 80%; text-align: center";
  const cos = inlineCSS ? `style="${tstyle}"` : 'class="hcp"';

  html += `<tbody ${cos}>`;
  html += `<tr><td></td><td>${hcp[2]}</td><td></td></tr>`;
  html += `<tr><td>${hcp[1]}</td><td></td><td>${hcp[3]}</td></tr>`;
  html += `<tr><td></td><td>${hcp[0]}</td><td></td></tr>`;
  html += "</tbody></table>";

  return html;
}

function explainhtml(auction, alert, showPlay, inlineCSS) {
  let html = "";

  const suithtml = !inlineCSS
    ? suitHTMLclass
    : pref.suitFourColor
    ? suitHTML4colorTP
    : suitHTMLplainTP;

  // Non-contract calls
  const txtPass = pref.auctionShortCalls ? "P" : "Pass";
  const txtDouble = pref.auctionShortCalls ? "X" : "Dbl";
  const txtRedouble = pref.auctionShortCalls ? "XX" : "Rdbl";

  // Figure out how much alert text there is.
  let nchar = 0;
  for (let i = 0; i < alert.length; i++) {
    if (alert[i] === undefined || alert[i].trim() === "") {
      continue;
    }
    nchar += alert[i].length;
  }

  let style = "margin-bottom: 0.3em; max-width: ";
  style += showPlay && nchar < 180 ? "7em" : "12em";

  html +=
    `<div style="${style}; text-decoration: underline">` +
    browser.i18n.getMessage("explanations") +
    "</div>" +
    "\n";

  for (let i = 0; i < alert.length; i++) {
    if (alert[i] === undefined || alert[i].trim() === "") {
      continue;
    }

    // Note: BBO explanations are already escaped for HTML

    // Substitute in suit symbols for !c, !d, !h, !s
    alertHTML = alert[i].replace(/![cdhs]/gi, symsub);

    // Make robot explanations look nicer.
    alertHTML = alertHTML.replace(/ -- /g, ": ");
    alertHTML = alertHTML.replace(/ -&gt; /g, " &rarr; ");

    let call = auction[i];
    if (call === "P") {
      callhtml = txtPass;
    } else if (call === "X") {
      callhtml = txtDouble;
    } else if (call === "XX") {
      callhtml = txtRedouble;
    } else {
      let denom = call.charAt(1);
      let hsym =
        denom === "N"
          ? pref.auctionTextNT
          : denom === "S"
          ? suithtml[0]
          : denom === "H"
          ? suithtml[1]
          : denom === "D"
          ? suithtml[2]
          : suithtml[3];
      callhtml = call.charAt(0) + hsym;
    }

    html +=
      `<div style="${style}">` + callhtml + " = " + alertHTML + "</div>" + "\n";
  }

  return html;

  function symsub(match) {
    let ix = suitrank.indexOf(match.charAt(1).toUpperCase());
    return suithtml[ix];
  }
}

function bsolDealerVul(bnum) {
  // Dealer and vulnerability convention used by John Goacher's online double
  // dummy solver.
  let dealer_order = ["N", "E", "S", "W"];
  let vul_order = ["None", "NS", "EW", "All"];

  let bzero = (bnum - 1) % 16;
  let d4 = bzero % 4;
  let dealer = dealer_order[d4];
  let vul = vul_order[(Math.trunc(bzero / 4) + d4) % 4];

  return [dealer, vul];
}

function pbnDealerVul(bnum) {
  // Dealer and vulnerability convention used by Portable Bridge Notation (PBN).
  let dealer_order = ["N", "E", "S", "W"];
  let vul_order = ["None", "NS", "EW", "Both"];

  let bzero = (bnum - 1) % 16;
  let d4 = bzero % 4;
  let dealer = dealer_order[d4];
  let vul = vul_order[(Math.trunc(bzero / 4) + d4) % 4];

  return [dealer, vul];
}

function dealHCP(d) {
  // Compute HCP for each hand and create d.whohas object for quick lookup
  // of which hand has each card.

  d.hcp = [];
  d.whohas = {};

  for (let i = 0; i < d.hand.length; i++) {
    let hand = d.hand[i],
      hcp = 0,
      suit = 0;

    for (let j = 0; j < hand.length; j++) {
      let c = hand.charAt(j);
      if (c === ".") {
        suit++;
        continue;
      }

      if (c === "A") {
        hcp += 4;
      } else if (c === "K") {
        hcp += 3;
      } else if (c === "Q") {
        hcp += 2;
      } else if (c === "J") {
        hcp += 1;
      }

      // Record which hand has each card. Helpful when generating the
      // cardplay table.
      d.whohas[suitrank.charAt(suit) + c] = i;
    }
    d.hcp[i] = hcp;
  }
  return d;
}

function contract(d) {
  // Determine the final contract from the auction.
  // Adds contractLevel, contractDenom, doubled, and declarer fields.

  let au = d.auction;
  let nbids = d.auction.length;

  if (
    nbids === 4 &&
    au[0] === "P" &&
    au[1] === "P" &&
    au[2] === "P" &&
    au[3] === "P"
  ) {
    // Passed out
    d.contractLevel = 0;
    d.contractDenom = "";
    d.doubled = "";
    d.declarer = "";
  } else if (au.length < 4 || au[nbids - 3] !== "P") {
    // Incomplete auction
    d.contractLevel = -1;
    d.contractDenom = "";
    d.doubled = "";
    d.declarer = "";
  } else {
    let dix;
    let doubled = "";
    for (let i = nbids - 4; i >= 0; i--) {
      let call = au[i];
      if (call.charCodeAt(0) >= 49 && call.charCodeAt(0) <= 55) {
        d.contractLevel = au[i].charAt(0);
        d.contractDenom = au[i].charAt(1);
        dix = i % 2;
        break;
      } else if (call === "XX") {
        doubled = "xx";
      } else if (call === "X" && doubled === "") {
        doubled = "x";
      }
    }
    d.doubled = doubled;

    // Figure out who bid the contract denomination first.
    for (let i = dix; i < nbids - 3; i += 2) {
      let call = au[i];
      if (
        call.charCodeAt(0) >= 49 &&
        call.charCodeAt(0) <= 55 &&
        d.contractDenom === au[i].charAt(1)
      ) {
        d.declarer = seatletters.charAt(
          (seatletters.indexOf(d.dealer) + i) % 4
        );
        break;
      }
    }
  }
  return d;
}

function seatLabels(name, isVugraph) {
  // Figure out how we are labeling the seats
  // name[4] - BBO handles for each seat

  let seatlabels = new Array(4);

  if (pref.boardPlayerNameMode === "seat") {
    const localize = pref.appBoardLocalization && app.lang !== "en";
    seatlabels = localize
      ? app.locale.seatName
      : ["South", "West", "North", "East"];
  } else if (pref.boardPlayerNameMode === "bbohandle") {
    seatlabels = name;
  } else if (pref.boardPlayerNameMode === "name") {
    if (isVugraph) {
      // The player's usernames are all set to the BBO handle of the VuGraph
      // presenter. So we need to use their names.
      for (let i = 0; i < 4; i++) {
        let fullname = vgnames[name[i]];
        seatlabels[i] = fullname === undefined ? name[i] : fullname;
      }
    } else {
      // Typical case
      for (let i = 0; i < 4; i++) {
        seatlabels[i] = bestAvailableName(name[i]);
      }
    }
  } else {
    console.error(
      "BBO Helper: seatlabels() unsupported boardPlayerNameMode: ",
      pref.boardPlayerNameMode,
      "Defaulting to BBO handles"
    );
    seatlabels = name; // fallback
  }

  return seatlabels;
}

function deal2pbn(d) {
  // lin2pbn() is the more robust and preferred function but there is one
  // case in the BBO app where we need this version, at least for now, but
  // should attempt to eliminate this dependency later.

  let pbn = "% Generated by BBO Helper browser add-on (Matthew Kidd)\n";

  let [dealer, vul] = pbnDealerVul(isNaN(d.bnum) ? 1 : d.bnum);

  if (!isNaN(d.bnum)) {
    pbn += '[Board "' + d.bnum + '"]' + "\n";
  }

  const seatnames = ["South", "West", "North", "East"];

  // PBN file traditionally start with West though it probably doesn't matter
  // for enumerating the player names.
  for (let i = 1; i < 5; i++) {
    pbn += "[" + seatnames[i % 4] + ' "' + d.name[i % 4] + '"]' + "\n";
  }

  pbn += '[Dealer "' + dealer + '"]' + "\n";
  pbn += '[Vulnerable "' + vul + '"]' + "\n";

  if (d.eventname !== undefined) {
    pbn += '[Event "' + d.eventname + '"]' + "\n";
  }

  pbn += '[Site "BBO"]' + "\n";

  // Traditional to start with the West hand for the deal ("W:")
  pbn +=
    '[Deal "' +
    "W:" +
    d.hand[1] +
    " " +
    d.hand[2] +
    " " +
    d.hand[3] +
    " " +
    d.hand[0] +
    '"]' +
    "\n";

  // Adds contractLevel, contractDenom, doubled, and declarer fields
  if (!d.contract && d.auction !== undefined) {
    d = contract(d);
  }

  if (d.declarer) {
    pbn += '[Declarer "' + d.declarer + '"]' + "\n";
  }

  if (d.contract) {
    let pbncontract = d.contract;
    // PBN format requires NT for notrump contracts.
    if (pbncontract.charAt(1) === "N" && pbncontract.length === 2) {
      pbncontract += "T";
    }
    pbncontract += d.doubled;

    pbn += '[Contract "' + pbncontract + '"]' + "\n";
  }

  if (d.nclaimed !== undefined) {
    pbn += '[Result "' + d.nclaimed + '"]' + "\n";
  }

  if (d.auction !== undefined && d.auction.length !== 0) {
    // Put in the auction.
    let notes = [];
    pbn += `[Auction "${d.dealer}"]`;
    for (let i = 0; i < d.auction.length; i++) {
      if (i % 4 === 0) {
        pbn += "\n";
      }
      let call = d.auction[i].toUpperCase();
      let pbncall = call === "P" ? "Pass" : call;

      // PBN format requires NT for notrump bids.
      if (pbncall.charAt(1) === "N") {
        pbncall += "T";
      }
      pbn += pbncall;
      // Not yet grabbing alerts in getDealViaDOM() in bbov3.js
      if (d.alert !== undefined && d.alert[i] !== undefined) {
        const note =
          d.alert[i] !== ""
            ? d.alert[i].replaceAll('"', "'")
            : "Alerted without an explanation";
        notes.push(note);
        pbn += " =" + notes.length + "=";
      }

      if (i % 4 !== 3) {
        pbn += "\t";
      }
    }
    pbn += "\n";

    for (let i = 0; i < notes.length; i++) {
      // Format example: [Note "1: Transfer"]
      pbn += '[Note "' + (i + 1) + ": " + notes[i] + '"]' + "\n";
    }
  }

  // Record which hand has each card. Helpful when generating the PBN card play.
  d.whohas = {};
  for (let i = 0; i < 4; i++) {
    let hand = d.hand[i];
    suit = 0;
    for (let j = 0; j < hand.length; j++) {
      let c = hand.charAt(j);
      if (c === ".") {
        suit++;
        continue;
      }
      d.whohas[suitrank.charAt(suit) + c] = i;
    }
  }

  // Seat index of the opening leader
  let lix = (seatletters.indexOf(d.declarer) + 1) % 4;
  d.leader = seatletters.charAt(lix);

  // Card play timing information sorted as appears in the PBN timing table
  // which has the same arrangement as the card play table.
  let playTimes = [];

  if (d.cardplay !== undefined && d.cardplay.length !== 0) {
    // Put in the card play.
    pbn += `[Play "${d.leader}"]` + "\n";

    let cardplay = d.cardplay;
    for (let i = 0; i < cardplay.length; i += 4) {
      // Cards played on this trick starting with the hand that makes the
      // opening lead.
      let cd = new Array(4);
      let tm = new Array(4);

      for (let j = 0; j < 4; j++) {
        if (i + j < cardplay.length) {
          let seatix = d.whohas[cardplay[i + j]];
          cd[seatix] = cardplay[i + j];
          if (d.playTimes) {
            tm[seatix] = d.playTimes[i + j];
          }
        }
      }
      if (d.playTimes) {
        playTimes = playTimes.concat(tm);
      }

      for (let j = 0; j < 4; j++) {
        let jr = (j + lix) % 4; // BBO seat index, i.e. South = 0
        // Dash for cards not played out on last trick.
        pbn += cd[jr] === undefined ? "-" : cd[jr];
        if (j < 3) {
          pbn += "\t";
        }
      }
      pbn += "\n";
    }
  }

  if (d.dd !== undefined) {
    // We have double dummy information. Add OptimumResultTable.
    // Note: need the literal slashes in this line of the PBN file.
    pbn += '[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]' + "\n";

    const ddSeats = "NSEW"; // BSOL double dummy table order
    const ddDenom = [" NT", "  S", "  H", "  D", "  C"];

    // Loop over seats.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        // Nice alignment via spaces.
        let ntricks = parseInt(d.dd.tr.charAt(i * 5 + j), 16);
        pbn +=
          ddSeats[i] +
          ddDenom[j] +
          (ntricks < 10 ? "  " : " ") +
          ntricks +
          "\n";
      }
    }
  }

  if (d.auctionTimes && d.auctionTimes.length > 0) {
    // Put in the auction timing table. PBN standard seems to be integer
    // seconds, so we will round. (The rather pointless MM:SS and HH:MM:SS
    // formats also seem permitted.)
    pbn += `[AuctionTimeTable "${d.dealer}"]` + "\n";
    for (let i = 0; i < d.auctionTimes.length; i++) {
      let tm = d.auctionTimes[i];

      // Reserve zero to mean that we do not have timing information (but
      // we joined the BBO table midway through the hand.
      if (tm > 0 && tm < 1000) {
        tm = 1000;
      } // mS

      // Compact 2 characters for timing in seconds though rare 100+ sec
      // call will shift columns in the row.
      tm = (tm / 1000).toFixed(0);
      pbn += tm.length === 2 ? tm : " " + tm;
      pbn += i % 4 === 3 ? "\n" : " ";
    }
    if (d.auctionTimes.length % 4 !== 0) {
      pbn += "\n";
    }
  }

  return pbn;
}

function deal2lin(d, seatlabels) {
  // Build LIN string from deal object.
  let lin = "st||";

  // Note: if pref.boardPlayerNameMode set to "seat", no player information
  // will be included (sometime desirable to protect the guilty).
  if (pref.boardPlayerNameMode === "bbohandle") {
    lin += "pn|" + seatlabels.join() + "|";
  } else if (pref.boardPlayerNameMode === "name") {
    // Remove and commmas and pipe symbols from names (yes both happen in
    // practice, e.g. "Mike | 2/1 or SAYC"), to avoid screwing up the LIN output.
    let cleanlabels = new Array(4);
    for (i = 0; i < 4; i++) {
      cleanlabels[i] = seatlabels[i].replace(/[,|]/g, "");
    }
    lin += "pn|" + cleanlabels.join() + "|";
  }

  // First digit after 'md|' indicates dealer (1 = South, 2 = West, ...)
  let lindix = seatletters.indexOf(d.dealer) + 1;
  lin +=
    "md|" +
    lindix +
    dothand2linhand(d.hand[0]) +
    "," +
    dothand2linhand(d.hand[1]) +
    "," +
    dothand2linhand(d.hand[2]) +
    "," +
    dothand2linhand(d.hand[3]) +
    "|";
  let linvul =
    d.vul === "All" ? "b" : d.vul === "NS" ? "n" : d.vul === "EW" ? "e" : "o";
  lin += "sv|" + linvul + "|rh||ah|Board " + d.bnum + "|";

  for (let i = 0; i < d.auction.length; i++) {
    let bid = d.auction[i];
    if (bid === "X") {
      bid = "d";
    } else if (bid === "XX") {
      bid = "r";
    }
    lin += "mb|" + bid + "|";
    if (d.alert !== undefined && d.alert[i]) {
      lin += "an|" + d.alert[i] + "|";
    }
  }
  if (d.cardplay) {
    for (let i = 0; i < d.cardplay.length; i++) {
      lin += "pc|" + d.cardplay[i] + "|";
    }
  }
  if (d.nclaimed !== undefined) {
    lin += "mc|" + d.nclaimed + "|";
  }

  return lin;
}

async function lin2pbn(
  lin,
  epochTime,
  eventname,
  dtricks,
  isMP,
  rawScoreNS,
  scoreNS
) {
  // EPOCHTIME  - Unix epoch time (seconds from Jan 1, 1970) for tournament when
  //              hand was played (optional)
  // EVENTNAME  - String like "#87901 Open Pairs San Diego Unit 539 1 PM"
  // ISMP       - Boolean indicating whether scoring matchpoints
  // DTRICKS    - Number of tricks taken by declarer. Used for ["Results"]
  // RAWSCORENS - Raw score for North-South (e.g. 1430)
  // SCORENS    - Score for North-South (matchpoint percentage or IMPs)

  let d = {};
  d.name = lin
    .match(/pn\|[^|]*/)[0]
    .substr(3)
    .split(",");
  d.hand = linboard2dotboard(lin2hands(lin));
  // Note: d.auction is stripped of trailing ! for alerts.
  [d.auction, d.alert, d.pbncontract, d.dix] = lin2auction(lin);
  d.cardplay = lin2cardplay(lin);

  // Get double dummy information but only if cached.
  let ddkey = "dd" + d.hand[0] + ":" + d.hand[1] + ":" + d.hand[2];
  let item = await browser.storage.local.get(ddkey);
  dd = item[ddkey];

  // Get timing information (if available). Keyed by hand-bbohandle for
  // one of seats (don't know which).
  timing = await getDealTiming(d.hand, d.name);

  // Map LIN vulnerability to BSOL vulnerability.
  const LINvul2PBNLvul = { o: "None", n: "NS", e: "EW", b: "Both" };
  const seatletters = "SWNE";
  const seatnames = ["South", "West", "North", "East"];

  let linVul = lin.match(/(?<=sv\|)[oneb]/);
  d.vul = linVul !== null ? LINvul2PBNLvul[linVul[0]] : "o";
  let linDealerIndex = lin.match(/(?<=md\|)\d/)[0] - 1;
  d.dealer = seatletters.charAt(linDealerIndex);

  let linBoard = lin.match(/(?<=ah\|Board\s*)\d+/);
  d.bnum = linBoard !== null ? parseInt(linBoard[0]) : 0;

  let pbn = "";

  if (eventname !== undefined) {
    pbn += '[Event "' + eventname + '"]' + "\n";
  }
  pbn += '[Site "BBO"]' + "\n";

  if (epochTime !== undefined) {
    // Write Date (YYYY.MM.DD) and Time (HH:MM:SS) PBN tags (local time).
    let dt = new Date(epochTime * 1000); // Convert to mS
    let yyyymmdd =
      dt.getFullYear() +
      "." +
      zeroPadInt(dt.getMonth() + 1, 2) +
      "." +
      zeroPadInt(dt.getDate(), 2);
    let hhmmss =
      zeroPadInt(dt.getHours(), 2) +
      ":" +
      zeroPadInt(dt.getMinutes(), 2) +
      ":" +
      zeroPadInt(dt.getSeconds(), 2);

    pbn += '[Date "' + yyyymmdd + '"]' + "\n";
    pbn += '[Time "' + hhmmss + '"]' + "\n";

    // Include UTC date and time for good measure.
    let UTCyyyymmdd =
      dt.getUTCFullYear() +
      "." +
      zeroPadInt(dt.getUTCMonth() + 1, 2) +
      "." +
      zeroPadInt(dt.getUTCDate(), 2);
    let UTChhmmss =
      zeroPadInt(dt.getUTCHours(), 2) +
      ":" +
      zeroPadInt(dt.getUTCMinutes(), 2) +
      ":" +
      zeroPadInt(dt.getSeconds(), 2);

    pbn += '[UTCDate "' + UTCyyyymmdd + '"]' + "\n";
    pbn += '[UTCTime "' + UTChhmmss + '"]' + "\n";
  }

  if (!isNaN(d.bnum)) {
    pbn += '[Board "' + d.bnum + '"]' + "\n";
  }

  // PBN file traditionally start with West though it probably doesn't matter
  // for enumerating the player names.
  for (let i = 1; i < 5; i++) {
    pbn += "[" + seatnames[i % 4] + ' "' + d.name[i % 4] + '"]' + "\n";
  }

  pbn += '[Dealer "' + d.dealer + '"]' + "\n";
  pbn += '[Vulnerable "' + d.vul + '"]' + "\n";

  // Traditional to start with the West hand for the deal ("W:")
  pbn +=
    '[Deal "' +
    "W:" +
    d.hand[1] +
    " " +
    d.hand[2] +
    " " +
    d.hand[3] +
    " " +
    d.hand[0] +
    '"]' +
    "\n";

  let scoring = isMP === undefined ? "?" : isMP ? "MP" : "IMP";
  pbn += '[Scoring "' + scoring + '"]' + "\n";

  if (rawScoreNS !== undefined) {
    pbn += '[Score "NS ' + rawScoreNS + '"]' + "\n";
  }

  if (scoreNS !== undefined) {
    pbn +=
      (isMP ? "[ScorePercentage " : "[ScoreIMP ") +
      '"NS ' +
      scoreNS +
      '"]' +
      "\n";
  }

  let lix;
  if (d.pbncontract !== undefined) {
    let ix = (linDealerIndex + d.dix) % 4;
    d.declarer = seatletters.charAt(ix);
    lix = (ix + 1) % 4;
    d.leader = seatletters.charAt(lix);
    pbn += '[Declarer "' + d.declarer + '"]' + "\n";
    pbn += '[Contract "' + d.pbncontract + '"]' + "\n";
  }

  if (dtricks !== undefined) {
    pbn += '[Result "' + dtricks + '"]' + "\n";
  }

  if (d.auction.length !== 0) {
    // Put in the auction.
    let notes = [];
    pbn += `[Auction "${d.dealer}"]`;
    for (let i = 0; i < d.auction.length; i++) {
      if (i % 4 === 0) {
        pbn += "\n";
      }
      let call = d.auction[i].toUpperCase();

      let pbncall =
        call.length === 2
          ? call
          : call === "P"
          ? "Pass"
          : call === "D"
          ? "X"
          : call === "R"
          ? "XX"
          : "-";
      // PBN format requires NT for notrump bids.
      if (pbncall.charAt(1) === "N") {
        pbncall += "T";
      }

      // In PBN, the suffix ! indicates a "good call" (NOT an alert), !! is a
      // "very good call", ? indicates a poor call, etc. Alerts are handled
      // as notes.

      pbn += pbncall;
      if (d.alert[i] !== undefined) {
        // Replace double quotes with single quotes because the PBN standard
        // uses double quotes to enclose tag names and values and the standard
        // doesn't seem to have an escape mechanism. Strictly speaking section
        // 2.2 of the PBN standard defines the character set as a subset of
        // ISO 8859/1 (Latin 1) so Unicode character should be replaced by ?
        // but I'm going to let this one slide.
        const note =
          d.alert[i] !== ""
            ? d.alert[i].replaceAll('"', "'")
            : "Alerted without an explanation";
        notes.push(note);
        pbn += " =" + notes.length + "=";
      }

      if (i % 4 !== 3) {
        pbn += "\t";
      }
    }
    pbn += "\n";

    for (let i = 0; i < notes.length; i++) {
      // Format example: [Note "1: Transfer"]
      pbn += '[Note "' + (i + 1) + ": " + notes[i] + '"]' + "\n";
    }
  }

  // Record which hand has each card. Helpful when generating the PBN card play.
  d.whohas = {};
  for (let i = 0; i < 4; i++) {
    let hand = d.hand[i];
    suit = 0;
    for (let j = 0; j < hand.length; j++) {
      let c = hand.charAt(j);
      if (c === ".") {
        suit++;
        continue;
      }
      d.whohas[suitrank.charAt(suit) + c] = i;
    }
  }

  // Card play timing information sorted as appears in the PBN timing table
  // which has the same arrangement as the card play table.
  let playTimes = [];

  if (d.cardplay.length !== 0) {
    // Put in the card play.
    pbn += `[Play "${d.leader}"]` + "\n";

    let cardplay = d.cardplay;
    for (let i = 0; i < cardplay.length; i += 4) {
      // Cards played on this trick starting with the hand that makes the
      // opening lead.
      let cd = new Array(4);
      let tm = new Array(4);

      for (let j = 0; j < 4; j++) {
        if (i + j < cardplay.length) {
          let seatix = d.whohas[cardplay[i + j]];
          cd[seatix] = cardplay[i + j];
          if (timing) {
            tm[seatix] = timing.playTimes[i + j];
          }
        }
      }
      if (timing) {
        playTimes = playTimes.concat(tm);
      }

      for (let j = 0; j < 4; j++) {
        let jr = (j + lix) % 4; // BBO seat index, i.e. South = 0
        // Dash for cards not played out on last trick.
        pbn += cd[jr] === undefined ? "-" : cd[jr];
        if (j < 3) {
          pbn += "\t";
        }
      }
      pbn += "\n";
    }
  }

  if (dd !== undefined) {
    // We have double dummy information. Add OptimumResultTable.
    // Note: need the literal slashes in this line of the PBN file.
    pbn += '[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]' + "\n";

    const ddSeats = "NSEW"; // BSOL double dummy table order
    const ddDenom = [" NT", "  S", "  H", "  D", "  C"];

    // Loop over seats.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        // Nice alignment via spaces.
        let ntricks = parseInt(dd.tr.charAt(i * 5 + j), 16);
        pbn +=
          ddSeats[i] +
          ddDenom[j] +
          (ntricks < 10 ? "  " : " ") +
          ntricks +
          "\n";
      }
    }
  }

  if (timing && timing.auctionTimes.length > 0) {
    // Put in the auction timing table. PBN standard seems to be integer
    // seconds, so we will round. (The rather pointless MM:SS and HH:MM:SS
    // formats also seem permitted.)
    pbn += `[AuctionTimeTable "${d.dealer}"]` + "\n";
    for (let i = 0; i < timing.auctionTimes.length; i++) {
      let tm = timing.auctionTimes[i];

      // Reserve zero to mean that we do not have timing information (but
      // we joined the BBO table midway through the hand).
      if (tm > 0 && tm < 1000) {
        tm = 1000;
      } // mS

      // Compact 2 characters for timing in seconds though rare 100+ sec
      // call will shift columns in the row.
      tm = (tm / 1000).toFixed(0);
      pbn += tm.length === 2 ? tm : " " + tm;
      pbn += i % 4 === 3 ? "\n" : " ";
    }
    if (timing.auctionTimes.length % 4 !== 0) {
      pbn += "\n";
    }
  }

  if (playTimes.length > 0) {
    // Put in the card play timing table.
    pbn += `[PlayTimeTable "${d.leader}"]` + "\n";

    for (let i = 0; i < playTimes.length; i++) {
      let tm = playTimes[i];
      if (tm === undefined) {
        pbn += " -";
      } // incomplete last trick.
      else {
        // Reserve zero to mean that we do not have timing information
        // (because we joined the BBO table midway through the hand.)
        if (tm > 0 && tm < 1000) {
          tm = 1000;
        } // mS

        // Compact 2 characters for timing in seconds though rare 100+ sec
        // play will shift columns in the row.
        tm = (tm / 1000).toFixed(0);
        pbn += tm.length === 2 ? tm : " " + tm;
      }
      pbn += i % 4 === 3 ? "\n" : " ";
    }
    if (playTimes.length % 4 !== 0) {
      pbn += "\n";
    }
  }

  return [pbn, d];
}

function lin2auction(lin) {
  // Parses auction, alerts, contract, and declarer from a LIN string.
  // Contract is returned in the style used by PBN.
  let auction = [];
  let alert = [];

  let lc = lin.substr(0, lin.length - 1).split("|");

  for (let i = 0; i < lc.length; i += 2) {
    if (lc[i] !== "mb") {
      continue;
    }
    let call = lc[i + 1];

    // Technically BBO seems to make a distinction between an alerted
    // call (! and end of call) and an announcement / explanation following
    // the call. We treat both cases as an alert.
    let callAlert = call.endsWith("!") ? "" : undefined;
    if (lc[i + 2] === "an") {
      callAlert = UTF8fix(lc[i + 3]);
      i += 2;
    }

    // Strip ! alert indication (necessary for downstream processing)
    if (call.endsWith("!")) {
      call = call.substr(0, call.length - 1);
    }

    auction.push(call);
    alert.push(callAlert);
  }

  // Figure out declarer and contract.
  let pbncontract, i1, dix;

  let nc = auction.length;
  let completedAuction =
    auction.length >= 4 &&
    auction[nc - 1].toUpperCase() === "P" &&
    auction[nc - 2].toUpperCase() === "P" &&
    auction[nc - 3].toUpperCase() === "P";

  if (
    auction.length === 4 &&
    completedAuction &&
    auction[0].toUpperCase() === "P"
  ) {
    // Passed out hand (PBN standard uses 'Pass')
    pbncontract = "Pass";
  } else if (completedAuction) {
    // Completed auction (and not passed out)

    for (i1 = auction.length - 4; i1 >= 0; i1--) {
      // Excludes double, redouble, and passes before last bid.
      if (auction[i1].length === 2) {
        break;
      }
    }

    // PBN format requires NT for notrump contracts.
    pbncontract = auction[i1].toUpperCase();
    if (pbncontract.charAt(1) === "N") {
      pbncontract += "T";
    }

    // Add X or XX if double or redoubled (PBN notation)
    for (let i2 = auction.length - 4; i2 > i1; i2--) {
      let call = auction[i2].toLowerCase(); // LIN standard
      if (call === "d") {
        pbncontract += "X";
        break;
      }
      if (call === "r") {
        pbncontract += "XX";
        break;
      }
    }

    let denom = auction[i1].charAt(1);

    // Figure out who bid it first.
    for (dix = i1 % 2; dix < auction.length - 3; dix += 2) {
      if (auction[dix].charAt(1) === denom) {
        break;
      }
    }
    dix = dix % 4;
  }

  return [auction, alert, pbncontract, dix];
}

function lin2cardplay(lin) {
  // Parse card play from a LIN string.
  let cardplay = [];

  // Who knows what case is being tossed at you. But we want capitalized suit in the
  // output so upcase everything once for efficiency.
  let lc = lin
    .substr(0, lin.length - 1)
    .toUpperCase()
    .split("|");

  for (let i = 0; i < lc.length; i += 2) {
    if (lc[i] === "PC") {
      cardplay.push(lc[i + 1]);
    }
  }
  return cardplay;
}

function lin2claimed(lin) {
  // Searches for number of tricks claimed (returns undefined if no claim was made)
  let ix = lin.indexOf("|mc|");
  if (ix === -1) {
    return;
  }
  return parseInt(lin.substring(ix + 4, lin.indexOf("|", ix + 4)));
}

function lin2hands(lin) {
  // LIN format does not include the East hand because it must contain whatever
  // cards are left. This function parses LIN for South, West, and North hand,
  // and derives the East hand, presenting it in the same format.
  const rankorder = "23456789TJQKA";

  let ix = lin.search(/\|md\|/i);
  if (ix === -1) {
    return;
  }

  // Sometimes the LIN format includes all four hands, sometimes it is missing the
  // final East hand (which can be worked out from the cards that are left). Might
  // be indicated by the single digit before the first (South) hand. Does 1 means
  // all four hands are included? 4 seems to mean only three hands are included.

  if (lin.charAt(ix + 59) !== "|") {
    // Four handed version
    // 53 = (13 cards + 4 suit letters) * 4 hand + 3 commas
    return lin.substr(ix + 5, 71).split(",");
  }

  // Three hand handed version.
  // 53 = (13 cards + 4 suit letters) * 3 hand + 2 commas
  let hand = lin.substr(ix + 5, 53).split(",");

  // Work out the East hand.
  let cards = new Array(52);
  let ic,
    suitOffset = 0;

  for (let i = 0; i < 3; i++) {
    suitOffset = 0;
    for (j = 1; j < 17; j++) {
      ic = rankorder.indexOf(hand[i].charAt(j));
      // Takes advantage of fact that suit characters don't overlap rank characters.
      if (ic === -1) {
        suitOffset += 13;
      } else cards[suitOffset + ic] = true;
    }
  }

  let east = "S";
  let suitix = 1;
  for (let i = 0; i < 52; i++) {
    if (cards[i]) {
      continue;
    }
    while (i >= suitix * 13) {
      east += suitrank.charAt(suitix);
      suitix++;
    }
    east += rankorder.charAt(i % 13);
  }
  hand[3] = east;
  return hand;
}

function dothand2linhand(hand) {
  // Formats a hand in suit format used by LIN md field. Cards in each suit are
  // listed by increasing rank (not ordinary decreasing rank).
  let s = "";
  let suits = hand.split(".");
  for (let i = 0; i < 4; i++) {
    // Seems like an inefficient string reversal but strings are very short.
    s += suitrank.charAt(i) + suits[i].split("").reverse().join("");
  }
  return s;
}

function linhand2dothand(hand) {
  // Converts LIN style STAH2JQD9TQKAC57A to dot style, e.g. AT.QJ2.AKQT9.A75
  // Sometimes rank is ordered low to high and needs to be reversed, other times
  // it is ranked high to low. ACBL Live for Tournaments does neither, linking
  // to the BBO Handviewer as CDSH and uses 10 for tens to boot. Handle whatever
  // crap is thrown at us below, even if it isn't ordered one way or another,
  // and irrespective of case.
  const rankorder = "AKQJT98765432";
  hand = hand.replace(/10/g, "T").toUpperCase();

  let unorderedSuits = hand.match(/[CDHS][AKQJT98765432]*/g);
  let suits = Array(4).fill("");

  for (let i = 0; i < 4; i++) {
    if (unorderedSuits[i] === undefined) {
      // Boundary case that is poorly coded by BBO. If a hand has a club void
      // the final C is left off, i.e. get something like 'S236TH678JQD589T'
      // Probably all voids are treated this way such that it is consistent.
      // and we'll make that assumption here.
      continue;
    }

    let ir = suitrank.indexOf(unorderedSuits[i].charAt(0));
    suit = unorderedSuits[i].substr(1);

    if (suit.length < 2) {
      suits[ir] = suit;
      continue;
    } // No sorting needed
    let ixlist = [];
    for (let j = 0; j < suit.length; j++) {
      ixlist.push(rankorder.indexOf(suit.charAt(j)));
    }
    ixlist.sort(function (a, b) {
      return a - b;
    });

    for (let j = 0; j < ixlist.length; j++) {
      suits[ir] += rankorder.charAt(ixlist[j]);
    }
  }
  return suits.join(".");
}

function linboard2dotboard(hd) {
  // Convert for all four hands of a board from LIN style to dot style.
  let hd2 = new Array(4);
  for (let i = 0; i < 4; i++) {
    hd2[i] = linhand2dothand(hd[i]);
  }
  return hd2;
}

function handEnglish(handL, hl) {
  // Converts an handL[] array using locale specific suit honor letters to
  // "standard" English letters.

  // If locale uses English honor letters, just return a deep copy of the array.
  if (hl === "JQKA") {
    return [...handL];
  }

  let hand = [];
  for (let i = 0; i < handL.length; i++) {
    // Two step process to handle possible hnoor letter overlap (don't have Perl tr
    // operator in JavaScript).
    let tmp = handL[i];
    tmp = tmp.replace(new RegExp(hl[0], "g"), "\x01");
    tmp = tmp.replace(new RegExp(hl[1], "g"), "\x02");
    tmp = tmp.replace(new RegExp(hl[2], "g"), "\x03");
    tmp = tmp.replace(new RegExp(hl[3], "g"), "\x04");
    tmp = tmp.replace(/\x01/g, "J").replace(/\x02/g, "Q");
    tmp = tmp.replace(/\x03/g, "K").replace(/\x04/g, "A");
    hand[i] = tmp;
  }
  return hand;
}

function rotatedeal(d, nseats) {
  // Rotate a deal by the specified number of seats.

  // Avoid unnecessary work.
  nseats = nseats % 4;
  if (nseats === 0) {
    return d;
  }

  // Deep copy using spread operator (only 1 level deep thought)
  let hand = [...d.hand];
  let name = [...d.name];

  // Rotate hands and player names
  for (let i = 0; i < 4; i++) {
    ix = (i + nseats) % 4;
    d.hand[ix] = hand[i];
    d.name[ix] = name[i];
  }

  // Rotates the localized hands (if present)
  if (d.handL !== undefined) {
    let handL = [...d.handL];
    for (let i = 0; i < 4; i++) {
      ix = (i + nseats) % 4;
      d.handL[ix] = handL[i];
    }
  }

  d.deal = d.hand[1] + ":" + d.hand[2] + ":" + d.hand[3] + ":" + d.hand[0];

  // Fix up dealer and declarer.
  d.dealer = seatletters.charAt((seatletters.indexOf(d.dealer) + nseats) % 4);
  d.declarer = seatletters.charAt(
    (seatletters.indexOf(d.declarer) + nseats) % 4
  );

  // This also rebuilds d.whohas (easier than to rotating its entries).
  d = dealHCP(d);

  // Fix up vulnerability.
  if (nseats % 2 === 1) {
    if (d.vul === "NS") {
      d.vul = "EW";
    } else if (d.vul === "EW") {
      d.vul = "NS";
    }
  }

  if (d.dd) {
    // Rotate double dummy table. ()dd.tr order is NSEW)
    let tr = d.dd.tr;
    let ndd = tr.substr(0, 5);
    let sdd = tr.substr(5, 5);
    let edd = tr.substr(10, 5);
    let wdd = tr.substr(15, 5);
    if (nseats === 1) {
      tr = wdd + edd + ndd + sdd;
    } else if (nseats === 2) {
      tr = sdd + ndd + wdd + edd;
    } else if (nseats === 3) {
      tr = edd + wdd + sdd + ndd;
    }
    d.dd.tr = tr;

    // Flip the Par Score sign
    if (nseats === 1 || nseats === 3) {
      d.dd.sNS = -d.dd.sNS;
      // Rare "hot" case where par is different if E-W bids first
      if (d.dd.sEW !== undefined) {
        d.dd.sEW === -d.dd.sEW;
      }
    }

    // Update par contracts ('cEW' is only for rare "hot" situation).
    let sides = ["cNS", "cEW"];
    for (let i = 0; i < sides.length; i++) {
      let contracts = d.dd[sides[i]];
      if (contracts === undefined) {
        continue;
      }
      if (nseats !== 2) {
        // Swap NS <--> EW
        contracts = contracts.replace(/(NS|EW)/g, (match) => {
          return match === "NS" ? "EW" : "NS";
        });
      }

      // Now fix up cases where a par contract is single seated.
      contracts = contracts.replace(/(?<=^|,)[SWNE](?= )/g, seatrotate);

      d.dd[sides[i]] = contracts;
    }
  }

  return d;

  function seatrotate(seat) {
    return seatletters.charAt((seatletters.indexOf(seat) + nseats) % 4);
  }
}

function bsol(d) {
  // BSOL online analyzes full hands. Abort if deal is not complete because user has
  // walked through some of the card play.
  if (d.hand[0].length !== 16) {
    console.info(
      "BBO Helper bsol(): " +
        "Can only perform double dummy analysis on a full hand."
    );
    return;
  }

  const seatlabels = seatLabels(d.name, false);
  const encodedLIN = encodeURIComponent(deal2lin(d, seatlabels));

  // Both bsol1 and bsol2 work but bsol2 has the latest features.
  let BSOLurl =
    "https://dds.bridgewebs.com/bsol2/ddummy.htm" +
    "?lin=" +
    encodedLIN +
    "&club=bbohelper&analyse=true";

  if (d.title !== undefined) {
    BSOLurl += "&title=" + encodeURIComponent(d.title);
  }

  console.info("BBO Helper bsol(): Launching BSOL2 in a new tab: %s", BSOLurl);
  return window.open(BSOLurl);
}

async function doubledummy(d, bCacheOnly, callback, bWaitResolve = false) {
  // Invokes John Goacher's Bridge Solver Online (BSOL) over HXR to obtain full
  // 5x4 double dummy results if result is not already cached in local storage.
  // If the double dummy fetch is successful, callback(d,dd) is called. If bCacheOnly
  // is callback(d,dd) is called only if double dummy information was already cached.
  //
  // D - Struct minimally containing hand[4], vul, bnum fields. If d.source =
  //     'prefetch', duplicated requests that have a callback defined will not
  //     be squelched (necessary in case board is bid / played very quickly
  //     before prefetch returns.
  //
  // bCacheOnly   - Return undef and skip callback if double dummy result is not
  //                cached
  // bWaitResolve - Always return double dummy info when bCacheOnly is false, i.e.
  //                await result instead of just returning undef and invoking callback
  //                when result is ready.

  if (d.hand[0].length !== 16) {
    return;
  }

  const queryTimeOut = 20000; // 20 sec
  let startTime;

  // 4th hand hand is known from remaining cards. This is a minimal attempt to
  // make more efficient use of local storage. A really good attempt would convert
  // the deal to a unique number (maybe later).
  let ddkey = "dd" + d.hand[0] + ":" + d.hand[1] + ":" + d.hand[2];

  let item = await browser.storage.local.get(ddkey);

  let dd; // object of double dummy info, including dd.tr double dummy string.
  let fulldeal, url;

  if (item[ddkey] !== undefined) {
    dd = item[ddkey];
    dd.wasCached = true;

    // Invoke the caller's callback function for the dummy dummy info.
    if (callback) {
      callback(d, dd);
    }
    return dd;
  } else if (!bCacheOnly) {
    // Will make XHR call directly to the double dummy engine, bypassing the
    // normal HTML for the double dummy solver. For the deal string 'S:'
    // indicates the starting hand (normally West but BBO starts with South).
    // &club URL parameter is probably ignored here, but pass it anyway to help
    // John Goacher figure out if BBO Helper is generating too much traffic.
    fulldeal = d.hand.join("x");
    url =
      "https://dds.bridgewebs.com/cgi-bin/bsol2/ddummy?request=m" +
      "&dealstr=" +
      "S:" +
      fulldeal +
      "&vul=" +
      d.vul +
      "&club=bbohelper";

    if (app.pendingDD.indexOf(fulldeal) !== -1) {
      // Already have a pending double dummy request for this deal. Squelch the
      // duplicate request. We want to do this in case a mh_hand PHP request
      // issued double dummy request is not answered before the History pane
      // UI is updated, changing the hand number and triggering a separate
      // request for the same deal.
      console.info(
        "BBO Helper: Squelching duplicated double dummy request: %s",
        fulldeal
      );
      return;
    }

    // Prefetch double dummy request will not squelch duplicate requests.
    if (d.source !== "prefetch") {
      app.pendingDD.push(fulldeal);
    }

    console.info(
      "BBO Helper: Querying double dummy result for board %d as %s",
      d.bnum,
      url
    );

    startTime = Date.now();
    // fetchWithTimeout(url, {timeout: queryTimeOut} ).then(fetchSuccess, fetchError);

    if (bWaitResolve) {
      // Caller wants double dummy info always.
      return await fetch(url).then(fetchSuccess, fetchError);
    } else {
      // Return undefined to caller (the callback function function caller
      // passed will get the job done).
      fetch(url).then(fetchSuccess, fetchError);
    }
  }

  function fetchError(err) {
    console.error(
      "BBO Helper: dummy dummy query failed for URL %s due to: %s",
      url,
      err
    );
    app.pendingDD.splice(app.pendingDD.indexOf(fulldeal));
  }

  async function fetchSuccess(response) {
    let queryTimeStr = ((Date.now() - startTime) / 1000).toFixed(3);

    // Remove the deal from the double dummy pending list.
    app.pendingDD.splice(app.pendingDD.indexOf(fulldeal), 1);

    // Response is JSON but responseType is '' which means text rather than "json"
    // So we need tp convert it. Response included 20 character 5x4 double dummy
    // string and also the par contract(s) and par score.
    //
    // {"sess": { sockref: "(null)", "ddtricks": "1205012050cbd8dcbd8d"}},
    // "contractsNS": "NS:EW 7H", "contractsEW": "EW:EW 7H",
    // "scoreNS": "NS -1510", "scoreEW": "EW 1510", "vul": "2"}
    //
    // Par contracts are comma separated, e.g. "NS:EW 3Hx,EW 4Cx" and followed
    // by an "x" for a doubled sacrificed (doubled dummy all down contracts are
    // doubled. If there are two digits before a denomination, e.g. '34D', this
    // means it suffices to bid 3D because opponents can not profitably compete
    // over it but it actually makes four. 'EW:NS 123H' means it suffices to bid
    // 1H (example hand had 2Cx-1 = -200 for opps) but 2H or 3H yield same result.
    // The rare par zero hand return a score of 0 and no contracts for either side.

    // Make sure response is okay.
    if (response.status !== 200) {
      // Server did not return an HTTP Status code. Request probably timed out.
      console.error(
        "BBO Helper: HTTP status code %d from BSOL " + "after (%s sec)",
        response.status,
        queryTimeStr
      );
      return;
    }

    try {
      ob = await response.json();
    } catch (e) {
      console.error(
        "BBO Helper: BSOL response was not valid JSON:",
        xhr.response
      );
      return;
    }
    if (typeof ob !== "object" || ob.sess === undefined) {
      console.error(
        'BBO Helper: BSOL response lacks expected "sess" attribute:',
        ob
      );
      return;
    }
    if (ob.errmsg) {
      // BSOL reported a problem (if everything is okay, then no ERRMSG key)
      console.error(
        "BBO Helper: BSOL returned error",
        ob.errno,
        errmsg,
        "when passed queried with",
        url
      );
      return;
    }
    console.info(
      "BBO Helper: doubledummy(): Double dummy response received from BSOL in %s sec",
      queryTimeStr
    );

    // Want to minimize use of local storage by shortening key names. Also, normally
    // contractsNS and contactsEW are the same. They are only different in a "hot"
    // situation, e.g. where both sides can make 1NT depending on who bids it first.
    // Likewise scoreNS and scoreEW are normally the same number just opposite sign.
    // We will only store the NS versions unless they differ.

    // Strip off leading 'NS ' or 'EW ' and 'NS:' or 'EW:' for contract(s)
    let sNS = parseInt(ob.scoreNS.substr(3));
    let sEW = parseInt(ob.scoreEW.substr(3));

    // Include timestamp for purging older items from cache (code later).
    dd = {
      tr: ob.sess.ddtricks,
      v: parseInt(ob.vul),
      d: Date.now(),
      cNS: ob.contractsNS.substr(3),
      sNS: sNS,
    };
    if (sNS + sEW !== 0) {
      dd["sEW"] = sEW;
      dd["cEW"] = ob.contractsEW.substr(3);
    }

    let newitem = {};
    newitem[ddkey] = dd;
    browser.storage.local.set(newitem);

    // Invoke the caller's callback function for the dummy dummy info.
    if (callback) {
      callback(d, dd);
    }
    return dd;
  }
}

async function getDealTiming(hand, handle) {
  // Retrieve auction and card play time for a hand based on a hand and
  // a player's handle. It could be saved as any of the four player's handles
  // though it will most commonly be found key by the handle of the player
  // in the South seat.
  //
  // HAND   - Array(4) of hands (dot format, e.g. 8.AJT987.965.QT3)
  // HANDLE - Array(4) of BBO handles
  //
  // Returns undefined if timing is not found.

  // There are four possible keys under which the timing location might be
  // stored (one for each seat) depending on which hands were known when the
  // timing information was stored.
  let keys = new Array(4);
  for (let i = 0; i < 4; i++) {
    keys[i] = "tm" + hand[i] + "-" + handle[i];
  }

  const items = await browser.storage.local.get(keys);
  let key;
  for (i = 0; i < keys.length; i++) {
    if (items[keys[i]] === undefined) {
      continue;
    }
    key = keys[i];
    break;
  }

  if (key === undefined) {
    console.info(
      "BBO Helper: getDealTiming(): no timing data found in local storage"
    );
    return;
  } else {
    console.info(
      "BBO Helper: getDealTiming(): timing data loaded using key:",
      key
    );
  }

  const t = items[key].t;
  const header = t.charCodeAt(0);

  const formatVersion = header % 256;
  if (formatVersion !== 1) {
    return undefined;
  }

  const ncalls = header >> 8;

  // Timing is packed in units of 1/100 sec to minimize local storage use.
  // But multiply by 10 to convert to msec for consistency with other code.
  let tm = new Array(t.length - 1);
  for (let i = 0; i < t.length - 1; i++) {
    let u16 = t.charCodeAt(i + 1);
    // Unicode UTF-16 surrogate issue. See saveDealTiming()
    if (u16 > 0xd800 && u16 !== 0xffff) {
      u16 -= 0x800;
    }
    tm[i] = t.charCodeAt(i + 1) * 10;
  }

  const auctionTimes = tm.slice(0, ncalls);
  const playTimes = tm.slice(ncalls);

  return { auctionTimes, playTimes };
}

async function showCopyAid(d, source) {
  // D      - Deal Structure
  // SOURCE - 'bbo' or 'handviewer'

  if (source !== "bbo" && source !== "handviewer") {
    console.error(
      "BBO Helper: showCopyAid(): source must be 'bbo' or 'handviewer'."
    );
    return;
  }

  if (pref.boardShowTiming) {
    // Get timing information (if available). Keyed by hand-bbohandle for
    // one of seats (don't know which).
    const dealTiming = await getDealTiming(d.hand, d.name);

    if (dealTiming !== undefined) {
      d.auctionTimes = dealTiming.auctionTimes;
      d.playTimes = dealTiming.playTimes;
    }
  }

  // TRUE means CSS styling is fully inlined
  let bdhtml = await boardhtml(d, true);

  let dv = document.getElementById("bh-board-copy-aid");

  if (dv !== null) {
    dv.remove();
  } // Doing a refresh

  // Create the copy-and-paste-aid.
  dv = document.createElement("div");
  dv.setAttribute("id", "bh-board-copy-aid");

  const isMac =
    window.navigator.platform &&
    window.navigator.platform.substr(0, 3) === "Mac";

  // Create the button bar.
  const buttonBar = document.createElement("div");
  dv.insertBefore(buttonBar, dv.children[0]);
  buttonBar.style =
    "border-bottom: 1px dotted #777; padding-bottom: 0.2em; " +
    "text-align: center";
  const modifierKey = isMac ? "&#x2318;" : "Ctrl";
  let text = browser.i18n.getMessage("copy_aid") + "<br>";
  text += isChrome
    ? browser.i18n.getMessage("copy_aid_instructions_Chrome")
    : browser.i18n.getMessage("copy_aid_instructions_Firefox") +
      " " +
      modifierKey +
      "+C";

  let style = "float: left; vertical-align: middle; text-align: left";
  buttonBar.innerHTML =
    `<span style="${style}">` + `<strong>${text}</strong></span>`;

  // Create button group.
  const sp = document.createElement("span");
  sp.style = "display: inline-block; margin-left: 0.3em; margin-right: 0.3em";
  buttonBar.appendChild(sp);

  let imgButton = [
    "rotate-left-32.png",
    "swap-32.png",
    "rotate-right-32.png",
    "star-32.png",
    "select-32.png",
    "HTML-32.png",
  ];
  const rot90 = [3, 2, 1, undefined, undefined];

  for (let i = 0; i < imgButton.length; i++) {
    const imgURL = browser.runtime.getURL(`buttons/${imgButton[i]}`);
    const bt = document.createElement("button");
    bt.class = "bh-board-copy-aid-button";
    bt.innerHTML = `<img src="${imgURL}">`;
    if (rot90[i] !== undefined) {
      bt.addEventListener(
        "click",
        () => {
          rotate(rot90[i]);
        },
        false
      );
    } else if (imgButton[i] === "star-32.png") {
      // For Star button that automatically positions declarer as the
      // South hand.
      bt.addEventListener("click", dealerSouth, false);
    } else if (imgButton[i] === "select-32.png") {
      if (isChrome) {
        // In Google Chrome we can write HTML directly to the clipboard as HTML.
        bt.addEventListener("click", html2clipboard, false);
      } else {
        // In Firefox we can select the HTML but user must copy with Ctrl+C
        bt.addEventListener("click", toggleSelection, false);
      }
    } else if (imgButton[i] === "HTML-32.png") {
      bt.addEventListener("click", board2clipboard, false);
    }
    sp.appendChild(bt);
  }

  // Create close "button" at the right.
  const imgClose = document.createElement("img");
  imgClose.src = browser.runtime.getURL("buttons/close-button-32.png");
  imgClose.style = "float: right; border: none";
  imgClose.addEventListener(
    "click",
    () => {
      dv.remove();
    },
    false
  );
  buttonBar.appendChild(imgClose);

  dv.style =
    "position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; " +
    "background: white; border: 1px solid #777";

  // Append before centering. The browser doesn't compute dv.offset{Width,Height}
  // until the <div> is appended to the document body.
  document.body.appendChild(dv);

  dv.insertAdjacentHTML("beforeend", bdhtml);

  // Center the copy-aid.
  let el =
    source === "handviewer"
      ? document.getElementById("theDiv")
      : document.getElementById("bbo_everything");

  // For full display area we would use window.inner{Width, Height}
  dv.style.left = (el.offsetWidth - dv.offsetWidth) / 2 + "px";
  dv.style.top = (el.offsetHeight - dv.offsetHeight) / 2 + "px";

  async function rotate(nseats) {
    d = rotatedeal(d, nseats);
    bdhtml = await boardhtml(d, true);

    // In case copy-aid closed during rotation process
    if (document.getElementById("bh-board-copy-aid") === null) {
      return;
    }

    dv.children[1].remove();
    dv.insertAdjacentHTML("beforeend", bdhtml);
  }

  async function dealerSouth() {
    // 0 means passed out and -1 is incomplete auction;
    if (d.contractLevel < 0) {
      return;
    }
    if (d.declarer === "S") {
      return;
    }

    const nseats = 4 - seatletters.indexOf(d.declarer);

    d = rotatedeal(d, nseats);
    bdhtml = await boardhtml(d, true);

    // In case copy-aid closed during rotation process
    if (document.getElementById("bh-board-copy-aid") === null) {
      return;
    }

    dv.children[1].remove();
    dv.insertAdjacentHTML("beforeend", bdhtml);
  }

  async function toggleSelection() {
    const dv = document.getElementById("bh-board-copy-aid");
    if (dv === null) {
      return;
    }

    const sel = document.getSelection();
    if (sel.anchorNode === dv) {
      sel.removeAllRanges();
      return;
    }

    // Select the board <div>, second child.
    const r = new Range();
    r.selectNode(dv.children[1]);
    sel.removeAllRanges();
    sel.addRange(r);

    const msg =
      browser.i18n.getMessage("board_selected") +
      " " +
      modifierKey +
      "+C " +
      browser.i18n.getMessage("to_copy_to_clipboard");
    docmessage(msg, source, "#FF007F");
  }

  function board2clipboard() {
    // Write HTML as plaintext to the clipboard. Some applications
    // like Thunderbird allow users to insert HTML so this is still helpful.
    navigator.clipboard.writeText(bdhtml).then(
      function () {
        console.info("BBO Helper: clipboard write succeeded.");
        docmessage(browser.i18n.getMessage("board_copy_text"), source);
      },
      function () {
        console.error("BBO Helper: clipboard write failed.");
        docmessage(browser.i18n.getMessage("board_copy_failed"), source);
      }
    );
  }

  function html2clipboard() {
    // Write HTML as HTML to the clipboard. Can only do this in Google Chrome
    // because Firefox has not yet implement what is still(!) a W3C Draft
    // specification in 2021.
    const blob = new Blob([bdhtml], { type: "text/html" });
    const item = new ClipboardItem({ [blob.type]: blob });

    navigator.clipboard.write([item]).then(
      function () {
        console.info("BBO Helper: clipboard write of HTML succeeded.");
        docmessage(browser.i18n.getMessage("board_copy_HTML"), source);
      },
      function (err) {
        console.error("BBO Helper: clipboard write of HTML failed.", err);
        docmessage(browser.i18n.getMessage("board_copy_failed"), source);
      }
    );
  }
}

function docmessage(message, source, color) {
  // Display a brief message centered in the <div> that displays the copy-and-paste aid.

  if (color === undefined) {
    color = "blue";
  }

  const dv = document.createElement("div");
  dv.innerHTML = message;

  dv.style =
    "position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; " +
    `background: #f0f0f0; color: ${color}; width: 8em; ` +
    "font-size: 150%; font-family: sans-serif";

  document.body.appendChild(dv);

  const el =
    source === "handviewer"
      ? document.getElementById("theDiv")
      : document.getElementById("bbo_everything");

  // For full display area we would use window.inner{Width, Height}
  // Note: The browser doesn't seem to compute dv.offset{Width,Height}
  // until the <div> is appended to the document body so code order
  // matters here.
  dv.style.left = (el.offsetWidth - dv.offsetWidth) / 2 + "px";
  dv.style.top = (el.offsetHeight - dv.offsetHeight) / 2 + "px";

  setTimeout(() => {
    dv.remove();
  }, 1500);
}

async function exportstorage() {
  // Generate a default filename.
  let date = new Date(Date.now());

  // Example: "18:11:07 GMT-0700 (Pacific Daylight Time)"
  let strLocalTime = date.toTimeString();
  if (strLocalTime.charAt(1) === ":") {
    strLocalTime = "0" + strLocalTime;
  }

  // Month is zero offset
  let datestr =
    date.getFullYear() +
    "-" +
    zeroPadInt(date.getMonth() + 1, 2) +
    "-" +
    zeroPadInt(date.getDate(), 2) +
    " " +
    strLocalTime.substr(0, 8).replace(/:/g, ".");

  let fname = "BBO Helper Local Storage " + datestr + ".json";

  // Null means retrieve all items.
  let items = await browser.storage.local.get(null);

  // This might create data fidelity issue for times longer than >= 552.96 sec
  // due to Unicode surrogates in UTF-16 being converted to the Unicode replacement
  // character (U+FFFD). See https://developer.mozilla.org/en-US/docs/Web/API/USVString
  let blob = new Blob([JSON.stringify(items)], { type: "application/json" });
  saveAs(blob, fname);
}

function selectfile(callback) {
  // Have user select a file.

  // Alas, Chrome has implemented this API but Firefox has not.
  // const jsonaccept = { 'application/json': ['.json'] };
  // const pickerOpts = { types: [ {description: 'JSON', accept: jsonaccept } ] };
  // [fileHandle] = await window.showOpenFilePicker(pickerOpts);
  // const fileData = await fileHandle.getFile();

  // Rely on older File API that requires an <input> element or drag-and-drop
  // to select a file.
  const dv = document.createElement("div");

  dv.style =
    "position: absolute; padding: 0.5em 0.5em 0.5em 0.5em; " +
    "border: 3px solid #777; border-radius: 7px; " +
    "background: #f0f0f0; color: blue; width: 40em";

  const el = document.createElement("input");
  el.style = "font-size: 200%; font-family: sans-serif";
  el.setAttribute("type", "file");
  el.addEventListener("change", fileselected, false);
  dv.appendChild(el);

  const bt = document.createElement("button");
  bt.setAttribute("type", "button");
  bt.innerHTML =
    '<span style="font-size: 200%; font-family: sans-serif">Cancel</span>';
  bt.addEventListener("click", cancelbutton, false);
  dv.appendChild(bt);

  document.body.appendChild(dv);

  // Note: The browser doesn't seem to compute dv.offset{Width,Height} until
  // the <div> is appended to the document body so code order matters here.
  dv.style.left = (window.innerWidth - dv.offsetWidth) / 2 + "px";
  dv.style.top = (window.innerHeight - dv.offsetHeight) / 2 + "px";

  function fileselected() {
    const filelist = this.files;
    dv.remove();
    callback(filelist[0]);
  }

  function cancelbutton() {
    dv.remove();
  }
}

async function importstorage(file) {
  // Import into local storage from a JSON file.

  console.log("BBO Helper: importstorage() reading from file:", file.name);
  const j = await file.text();

  let ob;
  try {
    ob = JSON.parse(j);
  } catch (e) {
    console.error("BBO Helper: ", e.message);
    return;
  }

  if (typeof ob !== "object") {
    console.error(
      "BBO Helper: importstorage(): JSON did not represent an object"
    );
    return;
  }

  let nDoubleDummy = 0,
    nTiming = 0;
  Object.keys(ob).forEach(function (key) {
    if (key.startsWith("dd")) {
      // Not a comprehensive validation.
      if (typeof ob[key] === "object") {
        nDoubleDummy++;
      } else {
        console.warn(
          "BBO Helper: importstorage(): key",
          key,
          "value is not an object."
        );
      }
    }
    if (key.startsWith("tm")) {
      // Not a comprehensive validation.
      if (typeof ob[key] === "object") {
        nTiming++;
      } else {
        console.warn(
          "BBO Helper: importstorage(): key",
          key,
          "value is not an object."
        );
      }
    } else {
      // Don't want to import 'pref' key or any other garbage.
      delete ob[key];
    }
  });

  if (nDoubleDummy === 0 && nTiming === 0) {
    console.info("BBO Helper: No items found to import into local storage.");
    return;
  }

  browser.storage.local.set(ob).then(() => {
    console.info(
      "BBO Helper:",
      nDoubleDummy,
      "double dummy and",
      nTiming,
      "timing items successfully imported into local storage."
    );
  });
}
