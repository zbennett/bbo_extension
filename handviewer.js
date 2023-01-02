/*
 * Made improvements to the standalone BBO Hand Viewer at
 * https://www.bridgebase.com/tools/handviewer.html
 * 
 *  - Add double 5x4 dummy and optimal contract display
 *  - Add PBN export and HTML hand copy to clipboard
 *  - Display real names (Alt+N to toggle)
 *  - Improve web page title to:
       'Board # - BBO Handviwer' (with &lin parameter)
 *     'Board # - 'Mon Jul 5, 2021, 7:00 PM session - BBO Handviwer' (with &myhands param)
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego) 
*/

"use strict";

// Tracks state of the Handviewer app. Much simply version of what is tracked
// for the BBO app. So far just handle double dummy related matters.
let app = { prefLoaded: false, pendingDD: [], titleFixed: false, lang: "en" };

// Map LIN vulnerability to BSOL vulnerability.
const LINvul2BSOLvul = { o: "None", n: "NS", e: "EW", b: "All" };

// Want full deal (all 52 cards) for launching the double dummy solver or
// creating PBN even if user has played through one or more tricks / cards
// and is in the Hand Diagram mode (default w/o Show Played Cards (not default)
// set fulldeal. However, if we try right away we'll get nothing because although
// the add-on JavaScript doesn't run until the page resources are loaded, it can
// run before the Hand Viewer JavaScript has finished, i.e. while the Hand Viewer
// is display 'Loading. Please Wait...'
let fulldeal;
setTimeout(() => {
  fulldeal = getDealOnlyViaDOM();

  if (!app.titleFixed) {
    // Add a useful page title if we haven't done so already. The BBO Hand Viewer
    // application leaves it blanks.
    let bstr = document.getElementsByClassName("vulInnerDivStyle")[0].innerText;
    document.title = "Board " + bstr + " - BBO Handviewer";
  }
}, 2000);

// Setup listener for Alt+Key keyboard shortcuts.
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
      // and the appearance of the quick find bar cause the BBO application to
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

kickOffDD();

async function kickOffDD() {
  console.log("kicking off");
  // Kick off the double dummy analysis based on the parameter of the URL used
  // to invoke the BBO Handviewer app. This is faster than waiting for DOM to
  // be populated.

  // Wait until preferences (PREF) have loaded from local storage. Typically
  // available in less than 1 mS.
  let sleepTime = 5,
    maxTries = 100;
  for (let itry = 1; itry <= maxTries; itry++) {
    await sleep(sleepTime); // mS
    if (app.prefLoaded) {
      console.info(
        "BBO Helper: PREF seen to be loaded after %d mS",
        sleepTime * itry
      );
      break;
    }

    if (itry === maxTries) {
      console.error(
        "Unable to load PREF after %d mS. Using defaults",
        maxTries * sleepTime
      );
    }
  }

  if (pref.hvDoubleDummyMode === "off") {
    return;
  }

  // This works around a BBO UTF-8 double encoding issue for suit symbols.
  const fixedLocation = doubleEncodedSuitFix(window.location.search);
  const p = new URLSearchParams(fixedLocation);

  if (p.get("lin") !== null) {
    // The BBO Handviewer was invoked with a LIN parameter. We can kick off the
    // double dummy analysis immediately.

    // Fetch info about players from the player database for Real Names functionality;
    let lin = p.get("lin");
    let pnameMatch = lin.match(/(?<=pn\|)[^|]+/i);
    if (pnameMatch !== null) {
      let pnames = pnameMatch[0].split(",");
      for (let i = 0; i < pnames.length; i++) {
        if (!realnames[pnames[i]]) {
          browser.runtime
            .sendMessage({ type: "lookup", bbohandle: pnames[i].toLowerCase() })
            .then(realnameResponse);
        }
      }
    }

    ddFromLIN(lin);

    return;
  }

  if (p.get("myhand") !== null) {
    // The BBO Handviewer was invoked with the MYHAND parameter. We can use
    // that to get a LIN string.
    linFromMyhand(p.get("myhand"));
    return;
  }

  // Hands may have been specified with s,w,n,e URL parameters. ACBL Live for
  // tournaments uses this format. And they screw up the suit order, going
  // C,D,S,H, i.e. neither low to high (BBO standard) or high to low. Also
  // they use 10 for tens.
  let hd = [p.get("s"), p.get("w"), p.get("n"), p.get("e")];
  if (hd[0] !== null && hd[1] !== null && (hd[2] !== null) & (hd[3] !== null)) {
    ddFromHands(hd, p);
    return;
  }

  console.warn(
    "BBO Helper: kickOffDD() was not able to parse a deal from ",
    window.location
  );
}

function linFromMyhand(myhand) {
  // The newer BBO API, which the old one redirect queries to via a 308 HTTP
  // response ("permanently moved"), does not take the leading 'M-'
  if (myhand.startsWith("M-")) {
    myhand = myhand.substr(2);
  }
  let url = "https://webutil.bridgebase.com/v2/mh_handxml.php?id=" + myhand;

  fetchWithTimeout(url, { timeout: 5000 }).then(fetchSuccess, fetchError);

  function fetchError(err) {
    console.error(
      "BBO Helper: myhand to LIN HTTP query failed for URL",
      url,
      "Fetch erorr was",
      err
    );
  }

  async function fetchSuccess(response) {
    // Make sure response is okay.
    if (response.status !== 200) {
      console.error(
        "BBO Helper: myhand to LIN HTTP query failed for",
        URL,
        "with HTTP code",
        response.status
      );
      return;
    }

    const text = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    const l = doc.getElementsByTagName("lin")[0];
    const err = l.getAttribute("err");

    // Query can succeed with BBO returning an error.
    if (err !== "0") {
      console.error(
        "BBO Helper: myhand to LIN query returned BBO err",
        err,
        "for URL",
        url
      );
      return;
    }

    app.lin = l.innerHTML;
    if (app.lin.endsWith("\n")) {
      app.lin = rtrim(app.lin, 1);
    }

    app.result_id = l.getAttribute("id");
    app.when_played = parseInt(l.getAttribute("when_played"));

    // Improve the window title.
    let dt = new Date(app.when_played * 1000);

    // Trim the seconds.
    let strLocalHHMM = dt.toLocaleTimeString().replace(/:\d\d /, " ");
    // Add comma to create something like "Wed Aug 11, 2021"
    let s = dt.toDateString();
    s = s.replace(" 0", " ");
    let strDate = s.substr(0, s.length - 5) + "," + s.substr(-5);

    // Can fail if LIN lookup comes back before page as finished rendering.
    // let bstr = document.getElementsByClassName('vulInnerDivStyle')[0].innerText;

    // This works better.
    let boardMatches = app.lin.match(/(?<=ah\|Board )\d+/);
    let boardstr =
      boardMatches === null ? "" : "Board " + boardMatches[0] + " - ";

    app.datestr = strDate + " " + strLocalHHMM;
    let doctitle = boardstr + app.datestr + " Session - BBO Handviewer";

    document.title = doctitle;
    app.titleFixed = true;

    // Fetch info about players from the player database.
    let pnameMatch = app.lin.match(/(?<=pn\|)[^|]+/);
    if (pnameMatch !== null) {
      let pnames = pnameMatch[0].split(",");
      for (let i = 0; i < pnames.length; i++) {
        if (!realnames[pnames[i]]) {
          browser.runtime
            .sendMessage({ type: "lookup", bbohandle: pnames[i].toLowerCase() })
            .then(realnameResponse);
        }
      }
    }

    // Double dummy calculation
    ddFromLIN(app.lin);
  }
}

function ddFromLIN(lin) {
  app.lin = lin;
  let hd = lin2hands(lin);

  let d = { hand: linboard2dotboard(hd) };

  // BBO seems to permit uppercase too for the vulnerability indication in the LIN
  // string. Made check case insensitive from 1.4.2 onward.
  let linVul = lin.match(/(?<=sv\|)[onebONEB]/);
  d.vul = linVul !== null ? LINvul2BSOLvul[linVul[0].toLowerCase()] : "o";

  let linBoard = lin.match(/(?<=ah\|Board\s*)\d+/);
  d.bnum = linBoard !== null ? parseInt(linBoard[0]) : 0;

  let bCacheOnly = pref.hvDoubleDummyMode === "ondemand";
  doubledummy(d, bCacheOnly, doubleDummyCallback);
}

function ddFromHands(hd, p) {
  let d = { hand: linboard2dotboard(hd) };

  let vul = p.get("v");
  if (vul !== null) {
    vul = vul.toLowerCase();
  }
  d.vul = vul !== null && LINvul2BSOLvul[vul] ? LINvul2BSOLvul[vul] : "o";

  let title = "";
  if (p.get("b") !== null) {
    // Improve the page title
    title = "Board " + p.get("b");
    d.bnum = parseInt(p.get("b"));
  }

  // Try to parse event description from commentary passed by ACBL Live
  // for tournaments. Example:
  //
  //   {<p><a href="http://live.acbl.org">ACBL Live</a></p> <p><b>Event:</b>
  //   North American Online Bridge Championships, 0-1500 Pairs, Jul 25, 2021</p>
  //   <p><b>Final Contract:</b> 4!Hx = Score: -500 <b>Optimal Contract:</b>
  //   -140 3!H-EW</p> <p><b>Double Dummy N/S:</b> 2!C 1/-NT !D5 !H4 !S5/4 NT7/6
  //   <b>Double Dummy E/W:</b> 2!D 3!H 1/2!S !C5 NT6</p> }

  let comment = p.get("p");
  if (comment !== null) {
    let match = comment.match(/(?<=<p><b>Event:<\/b>)[^<]*/);
    if (match !== null) {
      let eventName = match[0].trim();
      if (eventName !== "") {
        if (title !== "") {
          title += " - ";
        }
        title += eventName;
      }
    }
  }

  document.title = title;
  app.titleFixed = true;

  let bCacheOnly = pref.hvDoubleDummyMode === "ondemand";
  doubledummy(d, bCacheOnly, doubleDummyCallback);
}

async function doubleDummyCallback(d, dd) {
  // Bail if something went wrong with fetching double dummy calculation.
  if (dd === undefined) {
    return;
  }

  app.dd = dd;
  // True --> inline CSS
  let [ddtablehtml, parhtml] = ddhtml(dd, "Handviewer", true);

  // Sometimes we have double dummy information before the Hand Viewer has
  // finished rendering. Try rendering it every 100 mS for 10 sec. Could
  // set up a MutationObserver but this is good enough.
  let sleepTime = 20,
    maxTries = 100;
  for (let itry = 0; itry < maxTries; itry++) {
    console.log("before show");
    if (displayRubberScore(rshtml())) {
      console.log(
        "BBO Helper: Waited %d mS for BBO Handviewer to finish " +
          "rendering after receiving double dummy data.",
        itry * sleepTime
      );
      return;
    }
    console.log("after show");
    // if (displayDD(ddtablehtml, parhtml)) {
    //   console.log(
    //     "BBO Helper: Waited %d mS for BBO Handviewer to finish " +
    //       "rendering after receiving double dummy data.",
    //     itry * sleepTime
    //   );
    //   return;
    // }
    await sleep(sleepTime);
  }

  console.warn(
    "BBO Helper doubleDummyCallback(): " +
      "gave up waiting for BBO Handviewer to finish rendering after %d mS",
    sleepTime * maxTries
  );
}

function displayRubberScore(html) {
  // Bail if double dummy information is already present.
  if (document.getElementById("bhRubberScore") !== null) {
    return true;
  }
  console.log("in display rubber score");
  console.log(html);
  let theDiv = document.getElementById("theDiv");
  if (theDiv === undefined) {
    return;
  } // Shouldn't happen, just a guard

  let dv = document.createElement("div");
  dv.setAttribute("id", "bhRubberScore");

  dv.innerHTML = html;
  theDiv.appendChild(dv);

  dv.style =
    "position: absolute; padding: 0.1em 0.3em 0.3em 0.2em; " +
    "border-style: solid; border-width: 1px; border-color: #808080; " +
    "background: white";

  let hd = theDiv.getElementsByClassName("handDivStyle");
  console.log("hd length" + hd.length);
  if (hd.length !== 4) {
    return;
  } // Guard against UI changes.

  console.log(hd);

  // Place double dummy table in the lower right corner. For MaxHeight, don't
  // use height of South hand because that will be smaller than available space
  // below West hand if we are in Pictures of Cards mode.
  let maxWidth = hd[1].offsetWidth;
  let westBottom = hd[1].offsetTop + hd[1].offsetHeight;
  let southBottom = hd[0].offsetTop + hd[0].offsetHeight;
  let maxHeight = southBottom - westBottom;

  if (maxHeight < 10) return false;

  console.log(maxWidth);
  console.log(hd[1].offsetWidth);
  console.log(westBottom);
  console.log(southBottom);
  console.log(maxHeight);
  // console.info(theDiv.style.width,  theDiv.style.height, maxWidth, maxHeight,
  //	 hd[0].offsetTop,  hd[1].offsetTop);

  // 90% seems to work pretty well but sometimes it is too big. Dial back the font
  // size if necessary until it fits.
  for (let fontSize = 150; fontSize > 50; fontSize -= 10) {
    dv.style.fontSize = fontSize + "%";
    if (dv.offsetWidth < 0.96 * maxWidth && dv.offsetHeight < maxHeight) {
      break;
    }
  }

  // Place it in the lower left corner, centered horizontally below the West hand and
  // centered vertically to the left of the South hand.
  let x = hd[1].offsetLeft + (maxWidth - dv.offsetWidth) / 2;
  let y = westBottom + (maxHeight - dv.offsetHeight) / 2;

  // Percentage based position will handle window resizing somewhat gracefully
  // Repositioning and adjusting the font after detecting a resizing would be best.
  let theDivWidth = rtrim(theDiv.style.width, 2); // Remove 'px'
  let theDivHeight = rtrim(theDiv.style.height, 2); // Remove 'px'

  dv.style.left = ((100 * x) / theDivWidth).toFixed(1) + "%";
  dv.style.top = ((100 * y) / theDivHeight).toFixed(1) + "%";

  console.log(x);
  console.log(y);

  // Success
  return true;
}

function displayDD(ddtablehtml, parhtml) {
  // Bail if double dummy information is already present.
  if (document.getElementById("bhDoubleDummy") !== null) {
    return true;
  }

  // Create a <div> containing the double dummy and par information.
  let theDiv = document.getElementById("theDiv");
  if (theDiv === undefined) {
    return;
  } // Shouldn't happen, just a guard

  // Bail if BBO page rendering is not done.
  if (theDiv.style.width === "") {
    return;
  }

  let hd = theDiv.getElementsByClassName("handDivStyle");
  console.log("hd length" + hd.length);
  if (hd.length !== 4) {
    return;
  } // Guard against UI changes.

  console.log(hd);

  let dv = document.createElement("div");
  dv.setAttribute("id", "bhDoubleDummy");
  // z-index of -1 so that it doesn't overlap the South hand if it is too wide.
  // Relative font-size. The Hand Viewer will adjust the font depending on the
  // width of theDiv element.
  dv.style =
    "position: absolute; padding: 0.1em 0.3em 0.3em 0.2em; " +
    "border-style: solid; border-width: 1px; border-color: #808080; " +
    "background: white";

  // We have enough room in the Hand Viewer (unlike the BBO app) to place
  // both the double dummy table and the par information at the lower left.
  dv.innerHTML = ddtablehtml + parhtml;

  theDiv.appendChild(dv);

  // Place double dummy table in the lower right corner. For MaxHeight, don't
  // use height of South hand because that will be smaller than available space
  // below West hand if we are in Pictures of Cards mode.
  let maxWidth = hd[1].offsetWidth;
  let westBottom = hd[1].offsetTop + hd[1].offsetHeight;
  let southBottom = hd[0].offsetTop + hd[0].offsetHeight;
  let maxHeight = southBottom - westBottom;

  console.log(maxWidth);
  console.log(westBottom);
  console.log(southBottom);
  console.log(maxHeight);
  // console.info(theDiv.style.width,  theDiv.style.height, maxWidth, maxHeight,
  //	 hd[0].offsetTop,  hd[1].offsetTop);

  // 90% seems to work pretty well but sometimes it is too big. Dial back the font
  // size if necessary until it fits.
  for (let fontSize = 150; fontSize > 50; fontSize -= 10) {
    dv.style.fontSize = fontSize + "%";
    if (dv.offsetWidth < 0.96 * maxWidth && dv.offsetHeight < maxHeight) {
      break;
    }
  }

  // Place it in the lower left corner, centered horizontally below the West hand and
  // centered vertically to the left of the South hand.
  let x = hd[1].offsetLeft + (maxWidth - dv.offsetWidth) / 2;
  let y = westBottom + (maxHeight - dv.offsetHeight) / 2;

  // Percentage based position will handle window resizing somewhat gracefully
  // Repositioning and adjusting the font after detecting a resizing would be best.
  let theDivWidth = rtrim(theDiv.style.width, 2); // Remove 'px'
  let theDivHeight = rtrim(theDiv.style.height, 2); // Remove 'px'

  dv.style.left = ((100 * x) / theDivWidth).toFixed(1) + "%";
  dv.style.top = ((100 * y) / theDivHeight).toFixed(1) + "%";

  console.log(x);
  console.log(y);

  // Success
  return true;
}

async function analyze() {
  // Launch Bridge Solver Online (BSOL) double dummy solver for current hand.

  if (app.lin !== undefined) {
    // When the Handviewer is invoked with the LIN parameter or via a means that
    // we can query for the LIN string and have received the response, we can pass
    // full information to BSOL.

    const encodedLIN = encodeURIComponent(app.lin);

    // Both bsol1 and bsol2 work but bsol2 has the latest features.
    let BSOLurl =
      "https://dds.bridgewebs.com/bsol2/ddummy.htm" +
      "?lin=" +
      encodedLIN +
      "&club=bbohelper&analyse=true";

    if (app.datestr) {
      BSOLurl += "&title=" + encodeURIComponent(app.datestr + " BBO Session");
    }

    console.info(
      "BBO Helper analyze(): Launching BSOL2 in a new tab: %s",
      BSOLurl
    );
    window.open(BSOLurl);
  } else {
    let d = getDealViaDOM();

    // Substitute in full deal if necessary and if it is available.
    if (
      d.deal.length !== 67 &&
      fulldeal !== undefined &&
      fulldeal.length === 67
    ) {
      d.deal = fulldeal;
      d.hand = fulldeal.split(":");
    }

    if (app.datestr) {
      d.title = app.datestr + " BBO Session";
    }

    bsol(d);
  }
}

async function createpbn() {
  // Create a PBN file for the deal.

  const seatorder = "SWNE";
  const p = new URLSearchParams(window.location.search);

  let pbn, d;

  if (app.lin === undefined) {
    // It's highly preferable to generate the PBN from the LIN string, but
    // sometimes the deal is only specified using the s,w,n,e URL parameters.
    // ACBL Live for Tournaments uses this format.

    let hd = [p.get("s"), p.get("w"), p.get("n"), p.get("e")];
    if (
      hd[0] === null &&
      hd[1] === null &&
      (hd[2] === null) & (hd[3] === null)
    ) {
      // Usually bailing because myhand --> LIN query hasn't finished.
      let msg =
        p.get("myhand") === null
          ? "BBO No deal available via lin, myhand, or s,w,n,e URL parameters"
          : "myhand ---> LIN lookup has not completed yet";

      console.info("BBO Helper: createpbn(): " + msg);

      return;
    }

    d = { hand: linboard2dotboard(hd) };

    // Player names
    d.name = new Array(4);
    d.name[0] = p.get("sn") === null ? "" : p.get("sn");
    d.name[1] = p.get("wn") === null ? "" : p.get("wn");
    d.name[2] = p.get("nn") === null ? "" : p.get("nn");
    d.name[3] = p.get("en") === null ? "" : p.get("en");

    // Board number
    d.bnum = p.get("b") === null ? NaN : p.get("b");

    let auctionStr = p.get("a");
    if (auctionStr !== null) {
      // Auction where bids are crammed together in one string, e.g. 'ppp2sppp'
      auctionStr = auctionStr.toUpperCase();
      let auction = [];
      let bidCnt = 0,
        lastBid,
        lastBidIx;
      for (let ix = 0; ix < auctionStr.length; ix++) {
        let c = auctionStr.charAt(ix);
        if (c.charCodeAt(0) < 49 || c.charCodeAt(0) > 55) {
          let call = c === "P" ? "P" : c === "D" ? "X" : c === "R" ? "XX" : "";
          auction.push(call);
        } else {
          bidCnt++;
          let bid = auctionStr.substr(ix, 2);
          auction.push(bid);
          lastBid = bid;
          lastBidIx = auction.length - 1;
          ix++; // Bids are two characters long
        }
      }

      // Ignore fake auctions passed by ACBL Live just to set the contract.
      let fromACBL =
        p.get("p") !== null && p.get("p").match(/live\.acbl\.org/i) !== null;

      if (bidCnt > 1 || !fromACBL) {
        d.auction = auction;
      } else {
        // Add declarer and doubled fields because contract() will not
        // have the auction to do it.
        d.contract = lastBid;
        d.doubled = "";
        let dix = (seatorder.indexOf(p.get("d").toUpperCase()) + lastBidIx) % 4;
        d.declarer = seatorder.charAt(dix);
      }

      if (fromACBL) {
        // Event name starts after <b>Event:</b>
        let eventMatch = p.get("p").match(/(?<=Event:<\/b> )[^<]*/);
        if (eventMatch !== null) {
          d.eventname = eventMatch[0];
        }
      }
    }

    // Attach double dummy information.
    d.dd = app.dd;

    pbn = deal2pbn(d);
  } else {
    let pbncomment =
      "% Generated by BBO Helper browser add-on (Matthew Kidd)\n";

    if (p.get("myhand") !== null) {
      pbncomment += "% " + window.location + "\n";
    }

    [pbn, d] = await lin2pbn(app.lin, app.when_played);
    pbn = pbncomment + pbn;
  }

  // Explicitly convert to "\r\n" (CRLF) line termination here because we push
  // it down as a BLOB (so no automatic OS style conversion).
  pbn = pbn.replace(/\n/g, "\r\n");

  // Generate a default filename.
  let datePrefix = "";
  if (app.when_played !== undefined) {
    // Create YYYY-MM-DD HH.MM prefix (local time)
    let dt = new Date(1000 * app.when_played);
    let yyyymmdd =
      dt.getFullYear() +
      "-" +
      zeroPadInt(dt.getMonth() + 1, 2) +
      "-" +
      zeroPadInt(dt.getDate(), 2);
    let hhmm =
      zeroPadInt(dt.getHours(), 2) + "." + zeroPadInt(dt.getMinutes(), 2);
    datePrefix = yyyymmdd + " " + hhmm + " - ";
  }

  let fname = datePrefix + "Board " + d.bnum + ".pbn";

  let blob = new Blob([pbn], { type: "text/plain" });
  saveAs(blob, fname);
}

async function copyboard(mode) {
  // Toggles the display of the Board Copy-and-Paste Aid.

  let dv = document.getElementById("bh-board-copy-aid");
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

  let d = getDealViaDOM();
  if (app.datestr) {
    d.datestr = app.datestr;
  }
  if (app.datestr) {
    d.title = app.datestr + " BBO Session";
  }

  if (pref.boardShowDoubleDummy) {
    // Only if cached (2nd parameter) for good responsiveness.
    let dd = await doubledummy(d, true);
    if (dd) {
      d.dd = dd;
    }
  }

  console.info("BBO Helper: copyboard() deal:", d.deal);
  console.info("BBO Helper: copyboard() auction:", d.auctionstr);

  showCopyAid(d, "handviewer");
}

async function toggleNameDisplay() {
  // Display (or hides) popup showing real names + home state/province of each
  // player at the table.
  let dv = document.getElementById("bh-names");
  if (dv !== null) {
    dv.remove();
    return;
  }

  let felt = document.getElementById("theDiv");

  dv = document.createElement("div");
  dv.id = "bh-names";

  // Either myhands parameter lookup has not completed yet, or hand was passed with
  // s,w,n,e URL parameters (ala ACBL Live for Tournaments) are real names were
  // probably passed with sn,wn,nn,en URL parameters.
  if (app.lin === undefined) {
    return;
  }

  let pnameMatch = app.lin.match(/(?<=pn\|)[^|]+/);
  if (pnameMatch === null) {
    return;
  }

  let pnames = pnameMatch[0].split(",");

  let desc = [];
  for (let i = 0; i < 4; i++) {
    let bbohandle = pnames[i].toLocaleLowerCase();
    if (bbohandle.startsWith("~~")) {
      desc[i] = "Robot " + pnames[i];
      continue;
    }
    let p = realnames[bbohandle];
    if (!p) {
      desc[i] = pnames[i];
      continue;
    }
    desc[i] = p.fullname;
    if (p.state !== "") {
      desc[i] += " (" + p.state + ")";
    }
  }

  let html = "";
  html +=
    '<div style="position: absolute; top: 3%; width: 90%; ' +
    'text-align: center">' +
    desc[2] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; top: 35%; left: 3%; height: 10%">' +
    desc[1] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; top: 54%; right: 3%; height: 10%">' +
    desc[3] +
    "</div>" +
    "\n";
  html +=
    '<div style="position: absolute; bottom: 3%; width: 100%; ' +
    'text-align: center">' +
    desc[0] +
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
    "background: white; color: blue; height: 16em; width: 16em; " +
    "font-size: 150%; font-family: sans-serif; z-index: 1200; opacity: 0.95; " +
    "border: 1px solid #7f7f7f";

  felt.appendChild(dv);

  // Display auto-alert msg centered in the auction box.
  let left_px = (felt.offsetWidth - dv.offsetWidth) / 2;
  let top_px = (felt.offsetHeight - dv.offsetHeight) / 2;
  dv.style.left = left_px + "px";
  dv.style.top = top_px + "px";
}

function getDealOnlyViaDOM() {
  // Grab only the deal from the DOM. This will reflect current state of the
  // the hand if user has played through any tricks (or card by card).

  // hands[] has order South, West, North, East (BBO order)
  let hand = [];
  let el = document.getElementsByClassName("handDivStyle");
  for (let i = 0; i < 4; i++) {
    hand[i] = getHandViaDOM(el[i]);
  }

  // GIB, PBN standard order.
  return hand[1] + ":" + hand[2] + ":" + hand[3] + ":" + hand[0];
}

function getDealViaDOM() {
  // Find the deal by directly reading the DOM.
  //
  // Note: Different from same named function in handviewer.js because the DOM
  // is similar but not quite the same.

  let d = { name: [] };

  // Get board number. This element is always present however it can return an empty
  // string if the BBO Hand Viewer was launched using a 'lin' URL parameter which
  // is missing the 'ah|' field.
  let el = document.getElementsByClassName("vulInnerDivStyle");
  d.bstr = el[0].innerText;
  d.bnum = parseInt(d.bstr);

  // Get the player names.
  let namedivs = document.getElementsByClassName("nameTextDivStyle");
  for (let i = 0; i < 4; i++) {
    d.name[i] = namedivs[i].innerText;
  }

  // d.hands[] has order South, West, North, East (BBO order)
  let hand = [];
  el = document.getElementsByClassName("handDivStyle");
  for (let i = 0; i < 4; i++) {
    hand[i] = getHandViaDOM(el[i]);
  }
  d.hand = hand;

  // GIB, PBN format standard order (W, N, E, S)
  d.deal = hand[1] + ":" + hand[2] + ":" + hand[3] + ":" + hand[0];

  [d.dealer, d.vul] = bsolDealerVul(d.bnum !== "" ? d.bnum : 1);

  // Grab the auction. call dialog is presented W N E S but first call will be by dealer,
  // i.e. there aren't any placeholders if West is not dealer. There are four <div>
  // elements with 'auctionTableDivStyle'. First is header row 'W N E S'. Second is
  // the auction table. Third has contract and number of tricks.
  let ab = document.getElementsByClassName("auctionTableDivStyle")[1];

  let calls = ab.getElementsByTagName("td");

  let auctionstr = "";
  d.auction = [];
  d.alerted = [];

  // Ignore empty <td> elements before dealer's call.
  let dealerix = isNaN(d.bnum) ? 1 : d.bnum % 4;

  // There are 5 <td> elements per row for W N E S and then a spacer. Need
  // to skip over spacer.
  for (let ix = dealerix, i = 0; ix < calls.length; ix++, i++) {
    let call = calls[ix].innerText;

    if (call === "") {
      break;
    } // Empty <td> elements after final passes

    // Alerted calls have a yellow background in the auction box.
    d.alerted[i] =
      calls[ix].style.getPropertyValue("background-color") ===
      "rgb(255, 206, 0)";

    // Standardize to P, X, XX and C,D,H,S for suit symbols for downstream code.
    // BBO Handviewer already uses P, X, and XX (unlike BBO application which
    // uses Pass, Dbl and Rdbl). So just need to convert the Unicode suit symbols
    // to letters.
    if (call.length === 2 && call !== "XX") {
      // Regular call
      let symbol = call.substr(-1);
      let suit =
        symbol === "♠"
          ? "S"
          : symbol === "♥"
          ? "H"
          : symbol === "♦"
          ? "D"
          : "C";
      call = call.substr(0, 1) + suit;
    }

    d.auction[i] = call;
    auctionstr += call;

    if (i % 4 === 3) {
      auctionstr += ";";
    }
    auctionstr += " ";

    // Ignore 0% width <td> at end of each row.
    if (ix % 5 == 3) {
      ix++;
    }
  }

  // Trim trailing space and perhaps semicolon.
  if (auctionstr.substr(-2, 1) === ";") {
    auctionstr = auctionstr.substr(0, auctionstr.length - 2);
  } else {
    auctionstr = auctionstr.substr(0, auctionstr.length - 1);
  }

  // Haven't decided whether to trim final passes. Note: Leave all four
  // if it's a pass out. Also leave if less than 3 to indicate an incomplete
  // auction.

  d.auctionstr = auctionstr;

  // Add contract info based on the auction.
  d = contract(d);

  // Add "hcp" and "whohas" fields.
  d = dealHCP(d);

  // Usually have this unless viewer was invoked with 'myhands' URL parameter
  // and the LIN API lookup call has not been completed.
  if (app.lin) {
    d.lin = app.lin;
    // Ignore auction in first parameter. We already have it and the one
    // that would be returned uses a lowercase 'p' for Pass.
    [, d.alert] = lin2auction(app.lin);
  }

  return d;
}

function getHandViaDOM(elHandDiv) {
  // One for each suit: Spade, Hearts, Diamonds, Clubs.
  // <suitHoldingDivStyle> are sorted clubs, diamonds, hearts, spades
  let el = elHandDiv.getElementsByClassName("suitHoldingDivStyle");
  let hand = "";

  // The Hand Viewer has two modes: "Hand Diagram" and "Pictures of Cards".
  // In the first case there are 13 <div class="cardDivStyle"> elements
  // per hand. In the second there are 52 per hand, but only the visible
  // cards have a <font> element inside.
  let modePicturesOfCards =
    el[0].childElementCount === 13 && el[1].childElementCount === 13;

  if (modePicturesOfCards) {
    // Display is "Pictures of Cards"
    for (let i = 3; i >= 0; i--) {
      let elc = el[i].getElementsByClassName("cardDivStyle");
      for (let j = 0; j < elc.length; j++) {
        if (elc[j].childElementCount === 0) {
          continue;
        }

        // Seems like innerText should work here to pick up the single
        // character card rank... and yet it doesn't. So use innerHTML.
        let card = elc[j].children[0].innerHTML;
        if (card === "10") {
          card = "T";
        }
        hand += card;
      }
      if (i > 0) {
        hand += ".";
      }
    }
  } else {
    // Display is "Hand Diagram"
    for (let i = 3; i >= 0; i--) {
      let elc = el[i].getElementsByClassName("cardDivStyle");
      for (let j = 0; j < elc.length; j++) {
        let card = elc[j].innerText;
        if (card === "10") {
          card = "T";
        }
        hand += card;
      }
      if (i > 0) {
        hand += ".";
      }
    }
  }

  return hand;
}
