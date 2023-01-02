/* 
 * Adds "Download PBN" and "Session HTML" buttons to each session for BBO "My Hands" 
 *  
 * BBO Helper browser add-on (Matthew Kidd, San Diego) 
*/

"use strict";

// VAR not LET because APP is referenced in common.js. This primarily used in the 
// for the BBO application (bbov3.js) and standalone BBO Handviewer (handviewer.js)
// but we include it here too to prevent issue. linsetCache caches myhand2lin() 
// lookups so they don't have to be fetched separately for PBN Download and Full 
// Session HTML generation. This caching should really be done via a background page 
// but those are being replaced by Web Workers in Manifest V3, so transition to this 
// better solution later.
var app = { "downloadInProgress": false, "linsetCache": {}, "pendingDD" : [],
		"results" : {}, "lang": "en" };

// Map LIN vulnerability to BSOL vulnerability.
const LINvul2BSOLvul = {'o': 'None', 'n': 'NS', 'e': 'EW', 'b': 'All'};

document.addEventListener('keydown', (event) => {

	// Only trap Alt key combinations (without other modifiers)
	if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey ) { return; }

	// It's important to use event.code here. Mac OS uses the Option/Alt key combinations 
	// to generate special symbols and event.key will reflect that symbol.
	let code = event.code;
	if (code === 'KeyE') { keycatch(code); exportstorage(); }
	else if (code === 'KeyI') { keycatch(code); selectfile(importstorage); }
	
	// Override defaults, e.g. Alt+D in Firefox normally switches to the Address Bar.
	// and Alt+H is a hot key to the Help menu, etc.
	function keycatch(code) {
		console.info('BBO Helper: Alt+' + code.substr(3,1) + ' pressed.');
		event.preventDefault();
		event.stopPropagation();		
	}

},
	(err) => {
		console.error('BBO Helper: Failed to add keydown event listener: ', err)
	}
);

// Parse username from the URL. Scores are wrt to the user.
const URLparams = new URLSearchParams(window.location.search);
app.username = URLparams.get('username');

// There should always be a USERNAME URL parameter but the API will return something
// if you manually construct the URL and leave off the USERNAME URK parameter.
if (app.username !== undefined) { app.username = app.username.toLowerCase(); }

lookupAllHandles();
tableFix();

function lookupAllHandles() {
	// Gather up set of player handles for Real Name lookup.
	let bbohandles = new Set();
	
	const tb = document.getElementsByTagName('table')[0];
	if (tb === undefined) { return; }  // Avoid issue during testing when reloading add-on.
	
	const seatClasses = ['north', 'south', 'east', 'west'];
	for (let i=0; i<seatClasses.length; i++) {
		const el = tb.getElementsByClassName( seatClasses[i] );
		for (let j=0; j<el.length; j++) { bbohandles.add( el[j].innerText.toLowerCase() ); }
	}
	
	let uniqueHandles = [];
	for (const bbohandle of bbohandles.values() ) { uniqueHandles.push(bbohandle); }
	
	const msg = {'type': 'lookup_many', 'bbohandle': uniqueHandles };
	browser.runtime.sendMessage(msg).then(realnameResponse);
}

function tableFix() {
	// Add 'Download PBN' and 'HTML' buttons to tournament sessions.
	
	const tb = document.getElementsByTagName('table')[0];
	if (tb === undefined) { return; }  // Avoid issue during testing when reloading add-on.
	
	const ts = tb.getElementsByClassName('tourneySummary');
	
	for (let i=0; i<ts.length; i++) {
		// Empty colspan=2 space beneath Movie and Traveller columns.
		const el = ts[i].children[4];
		
		// Convenience for development to prevent multiple buttons being added
		// to the row when the extension is reloaded. (Developer only issue!)
		if ( el.children.length !== 0 ) { el.replaceChildren(); }
		
		addButtons(el);
	}
	
	// Add 'Download PBN' and 'HTML' buttons to Social Bridge and Team Game sessions.
	// If the day starts with such a session, just add buttons to YYYY-MM-DD row that
	// indicates the start of the day. Otherwise we need to add a row to the table
	// so we have a place to put the buttons.
	const rows = tb.getElementsByTagName('tr');
	const nrows = rows.length;
	let prevClassName;
	
	for (let i=0; i<nrows; i++) {
		const row = rows[i];
		const cname = row.className;
		
		if ( row.children[0].innerText.match( /^\d{4}-\d{2}-\d{2}/ ) !== null ) {
			if (i+2 >= nrows || rows[i+2].className === 'tourneySummary' ) { 
				prevClassName = cname; continue;
			}
			// New day and not started by a tournament which has its own tournament row
			// where we have already add the buttons.
			
			// Adjust column span to make a place for the Download PBN button.
			row.children[0].setAttribute('colspan', 9);
			
			// Convenience for development to prevent multiple buttons being added
			// to the row when the extension is reloaded.
			if ( row.children[1] ) { row.children[1].remove(); }
			
			let th = document.createElement('th');
			th.setAttribute('colspan', 2);
			th.style.textAlign = 'center';
			
			addButtons(th);
			
			row.appendChild(th);
		}
		else if ( cname !== prevClassName && (cname === 'mbc' || cname === 'team') &&
			prevClassName !== 'tourneySummary' && prevClassName !=='' ) {
			// Have non-tournament boards after a different type of boards part way
			// through a day. Need to make a row to hold the buttons.
			
			let nrow = document.createElement('TR');
			nrow.className = 'social';
			nrow.bgColor = '#EEE5E5';  // Same color as tournment headers
			
			let td1 = document.createElement('TD');
			td1.innerText = 'Social Bridge';
			td1.colSpan = 9;
			
			let td2 = document.createElement('TD');
			td2.colSpan = 9;
			addButtons(td2);
			
			nrow.appendChild(td1);
			nrow.appendChild(td2);
			
			tb.children[0].insertBefore(nrow, row);
		}
		
		prevClassName = cname;
	}
}

function addButtons(el) {
	// Add ''PBN Download' and 'HTML' buttons to an element.
	
	// Add Download PBN button.
	let bt1 = document.createElement('button');
	bt1.className = 'pbn';
	bt1.setAttribute('type', 'button');
	bt1.innerText = browser.i18n.getMessage('download_pbn');
	
	bt1.addEventListener("click", btnClick );
	
	el.appendChild(bt1);
	
	// Add Session HTML button.
	let bt2 = document.createElement('button');
	bt2.className = 'sess';
	bt2.setAttribute('type', 'button');
	bt2.innerHTML = 'HTML';
	
	bt2.addEventListener("click", btnClick );
	
	el.appendChild(bt2);
}

function btnClick() {
	// Handles clicks on 'Download PBN' and 'HTML' buttons
	
	// What we do with the boards depends on which type of button was pressed.
	let cname = this.className;
	let callback = cname === 'pbn' ? pbnSave : cname === 'sess' ? sessionHTML : undefined;
	if (callback === undefined) {
		console.error('BBO btnClick() unsupported button class: ', cname); return;
	}
		
	if (app.downloadInProgress) {
		let msg = browser.i18n.getMessage('download_in_progress');
		windowMessage(msg); return;
	}
	
	app.downloadInProgress = true;
	
	let tname, unixEpoch, rowtype;
	
	let row = this.parentNode.parentNode;
	if (row.className === 'tourneySummary') {
		tname = row.children[0].innerText;
		let firstRow = row.nextElementSibling;
		// Will be 'team' or 'tourney' (for pair tournament)
		rowtype = firstRow.className;
		
		// Also pickup the tournament id from the hyperlink so that we can construct
		// a helpful default filename for the PBN output.
		let tlink = row.children[0].children[0].getAttribute('href');
		let tourney_id = tlink.match( /(?<=t=)[^&]+/ )[0];
		unixEpoch = tourney_id.match( /\d+$/ )[0];
	}
	else {
		// If buttons got added to a YYYY-MM-DD row, we need to skip the header row
		// but they were placed on a row we inserted, then first board is on next row.
		if (row.className !== 'social') { row = row.nextElementSibling; }
		let firstRow = row.nextElementSibling;
		
		// mbc means "Main Bridge Club"
		rowtype = firstRow.className;
		tname = firstRow.className === 'mbc' ? 'Social Bridge' : 'Team Game';
		let str = firstRow.children[9].innerHTML.match( /(?<=when_played=)\d+/ )[0];
		unixEpoch = parseInt(str);
	}

	let ids = [];
	while (row = row.nextElementSibling) {
		if (row.className !== rowtype) { break; }
		
		const cols = row.children;
		
		const url = cols[9].children[0].getAttribute('href');
		let ix = url.indexOf('&myhand=');
		let myhand = url.substr(ix+8);

		// The newer BBO API, which the old one redirects queries to via a 308 HTTP
		// response ("permanently moved"), does not take the leading 'M-'		
		if ( myhand.startsWith('M-') ) { myhand = myhand.substr(2); }
		ids.push(myhand);
				
		const result = cols[6].innerText;
		// Passed out boards and A== (or other averages) awarded to unplayed boards
		let dtricks = result.startsWith('P') ? 0 : result.startsWith('A') ? undefined : 
			parseInt(result.charAt(0)) + 6;
		if ( dtricks !== 0 && dtricks !== undefined && ! result.endsWith('=')) {
			dtricks += parseInt( result.substr(result.length-2) );
		}
		
		// Scores are wrt to the bbohandle being queried
		const isEWscore = cols[4].innerText.toLowerCase() === app.username || 
			cols[5].innerText.toLowerCase() === app.username;
		
		const rawScore = cols[7].innerText;
		const score = cols[8].innerText;   // Will include trailing % if MP
		const travellerURL = 'https://www.bridgebase.com' + cols[10].firstChild.getAttribute('href');
		
		app.results[myhand] = { dtricks, isEWscore, rawScore, score, travellerURL };
	}

	const tdate = new Date(unixEpoch * 1000);
	
	// Though the PBN specification doesn't seem to have in issue with an event
	// name that starts with a # (e.g. "#87901 Open Pairs..." ), Bridgify doesn't
	// seem to pickup the event (as Description) if it does.
	let tnameBBO = tname.startsWith('#') ? 'BBO ' + tname : tname;
	
	// toTimeString() output looks like "18:11:07 GMT-0700 (Pacific Daylight Time)"
	let strLocalTime = tdate.toTimeString();
	if (strLocalTime.charAt(1) === ':') { strLocalTime = '0' + strLocalTime; }
	
	// Month is zero offset. Discard seconds below with substr(0,5)
	let startStrFname = tdate.getFullYear() + '-' + zeroPadInt(tdate.getMonth()+1,2) +
		'-' + zeroPadInt(tdate.getDate(),2) + ' ' 
		+ strLocalTime.substr(0,5).replace(/:/g, '.');

	// Setup progress notification. 
	let dv = document.createElement('div');
	
	dv.style = 'position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; ' + 
		'background: #f0f0f0; border: solid 1px black; color: blue; width: 12em; ' + 
		'font-size: 150%; font-family: sans-serif';
	
	fetchdeals(ids, dv, callback);
	
	
	async function pbnSave(ids, linset) {
		let fname = startStrFname + ' ' + tname + '.pbn';

		// Create the PBN file after all LIN has been downloaded for all hands.
		dv.innerText = browser.i18n.getMessage('preparing_PBN');
		
		let pbn = "% Generated by BBO Helper browser add-on (Matthew Kidd)\n";
		for (let i=0; i<ids.length; i++) {
			let myhand = ids[i];
			// Skip board if the LIN data could not be downloaded.
			let ls = linset[myhand];
			if ( ls === undefined ) { continue; }
			const dtricks = app.results[myhand].dtricks;
			
			// Raw score and MP/IMP score from North-South perspective.
			const isEWscore = app.results[myhand].isEWscore;
			let rawScoreNS = parseInt( app.results[myhand].rawScore );
			if ( Number.isNaN(rawScoreNS) ) { rawScoreNS = undefined; }
			else if ( isEWscore ) { rawScoreNS = -rawScoreNS; }
			
			let scoreNS = app.results[myhand].score;
			let isMP = scoreNS.endsWith('%');
			
			if (isMP) {
				scoreNS = parseFloat( scoreNS.substring(0, scoreNS.length-1) );
				// Avoid long ugly numbers due to floating point roundoff
				if ( isEWscore ) { scoreNS = Math.round(10000 - 100 * scoreNS) / 100; }
			}
			else {
				scoreNS = parseFloat( scoreNS );
				if ( isEWscore ) { scoreNS = -scoreNS; }
			}

			let [pbn1] = await lin2pbn(ls.lin, ls.when_played, tnameBBO, dtricks, 
				isMP, rawScoreNS, scoreNS );
			
			if (i !== 0) { pbn += '\n'; } 
			pbn += pbn1;
		}

		// Explicitly convert to "\r\n" (CRLF) line termination here because we push
		// it down as a BLOB (so no automatic OS style conversion).
		pbn = pbn.replace( /\n/g, '\r\n');
		
		let blob = new Blob( [pbn], {type: 'text/plain'});
		saveAs(blob, fname);
		
		dv.remove();
		app.downloadInProgress = false;
	}
	
	
	async function sessionHTML(ids, linset) {
		
		let nBoards = ids.length, nDownloaded = 0, nWithTiming = 0, nWithDD = 0;
		
		// Generate the HTML for the boards first because timing and double dummy
		// checkbox details depend on availability of timing and double dummy.
		let htmlBoards = '';
		for (let i=0; i<nBoards; i++) {
			let myhand = ids[i];
			// Skip board if the LIN data could not be downloaded.
			const ls = linset[myhand];
			if ( ls === undefined ) { continue; }
			nDownloaded++;
			
			const lin = linset[myhand].lin;
			let d = await lin2d(lin);
			
			// Add fields that aren't derivable from LIN.
			let res = app.results[myhand];
			d.score = res.score;
			d.rawScore = res.rawScore;
			d.travellerURL = res.travellerURL;
			
			htmlBoards += '\n\n' + '<!-- Board ' + d.bstr + ' -->' + '\n\n';
			
			// FALSE in 2nd arg means CSS styling will not be full inline. This means 
			// styling from 'session.css' injected above will apply. TRUE in 3rd arg
			// means all board display options will be included regardless of user
			// preference (though some may initially be hidden based on PREF)
			const bdhtml = await boardhtml(d, false, true);
			htmlBoards += bdhtml;
			
			// Not the best approach, but it will do.
			if ( bdhtml.indexOf('class="bh-dd-par"') !== -1 ) { nWithDD++; }
			if ( bdhtml.indexOf('class="tm"') !== -1 ) { nWithTiming++; }
			
			dv.innerText = (i+1).toString() + ' ' + 'Boards → HTML';	
		}		

		htmlBoards += '</main>\n</body></html>';
		
		// Generate the start of the HTML.
		const title = startStrFname + ' ' + tname + ' Boards';
		
		let html = 
`<!DOCTYPE html>
<html lang="en">
<head>
<!-- Created by BBO Helper (Matthew Kidd, San Diego, CA) -->
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="Content-Style-Type" content="text/css">
<meta http-equiv="Content-Script-Type" content="text/javascript">

<title>${title}</title>

`;

		// Insert the CSS
		const cssURL = browser.runtime.getURL("sesshands/session.css");
		const cssResp = await fetch(cssURL);
		const css = await cssResp.text();
		
		html += '<style type="text/css">\n' + css + '</style>' + '\n';

		// Insert preferences that are relevant.
		const prefsToCopy = ['suitFourColor', 'boardShowTiming', 'boardIncludeBorder', 
			'boardShowAuction', 'boardShowContract', 'boardShowPlay', 'boardShowHCP', 
			'boardShowLinks', 'boardShowDoubleDummy', 'boardShowExplanations'];
		let pref2 = {};
		for (let i=0; i<prefsToCopy.length; i++) {
			let prefname = prefsToCopy[i];
			// Exclude preferences that are not relevant.
			if (prefname === 'boardShowDoubleDummy' && nWithDD === 0) { continue; }
			if (prefname === 'boardShowTiming' &&  nWithTiming === 0) { continue; }
			
			pref2[prefname] = pref[prefname];
		}
		
		html += '\n' + '<script type="text/javascript">' + '\n' + 
			'var pref = ' + JSON.stringify(pref2) + ';\n\n';
			
		// Insert the JavaScript
		const jsURL = browser.runtime.getURL("sesshands/session.js");
		const jsResp = await fetch(jsURL);
		html += await jsResp.text();
			
		html +=	'</script>' + '\n\n';

		html += 
`</head>

<body>
<main role="main">
<h1>${title}</h1>

`;
		// Insert the checkbox options.
		html += checkboxHTML(prefsToCopy, nBoards, nWithTiming, nWithDD);
		
		if (nDownloaded !== nBoards) {
			const nMissing = nBoards - nDownloaded;
			html += '<p class="warn">Unable to download LIN string from BBO for ' +
				nMissing + ' boards.</p>' + '\n\n';
		}
		if (nWithTiming === 0) {
			html += '<p>No timing information was available for any boards.</p>' + '\n\n';
		}
		if (nWithDD === 0) {
			html += '<p>No double dummy data was cached for any boards. ' +
			'To see double dummy results, enable the <span class="prefname">' +
			'Always include double dummy table in session HTML</span> option in ' +
			'the full settings of BBO Helper and download the session again.</p>' + '\n\n';
		}
		
		// Indicate for whom the scores apply.
		html += '<p>Raw scores and matchpoint percentage or IMP scores apply to user ' +
			'<span class="username">' + app.username + '</span> and partner.</p>' + '\n\n';
		
		// Explicitly convert to "\r\n" (CRLF) line termination here because we push
		// it down as a BLOB (so no automatic OS style conversion). Some of the included
		// code (e.g. the CSS) already has CRLF line termination so be careful here.
		html = (html + htmlBoards).replace( /(?<!\r)\n/g, '\r\n');
		
		// Change time in event title such as 1:10 PM --> 1.10 PM to generate an allowable 
		// filename. Left to their own devices, Firefox and Chromium will replace the color 
		// with a space and and underscore respectively.
		let fname = title.replace(':', '.') + '.htm'; 
		
		let blob = new Blob( [html], {type: 'text/plain'});
		saveAs(blob, fname);
		
		dv.remove();
		app.downloadInProgress = false;
	}
	
}

function checkboxHTML(prefsToCopy, nBoards, nWithTiming, nWithDD) {

	let html = '';
	
	html += '<div id="options">' + '\n'
	for (let i=0; i<prefsToCopy.length; i++) {
		let p = prefsToCopy[i];
		
		let desc = browser.i18n.getMessage('options_' + p);
		if (desc === "") {
			desc = '<span style="color: red">' + 
				'Language file is missing translation for message id ' +
				'options_' + p + '</span>';
		}
		if (p === "boardShowTiming" && nWithTiming !== nBoards) {
			if (nWithTiming === 0) { continue; }
			desc += ' (' + nWithTiming + ' of ' + nBoards + ' boards)';
		}
		else if (p === "boardShowDoubleDummy" && nWithDD !== nBoards) {
			if (nWithDD === 0) { continue; }
			desc += ' (' + nWithDD + ' of ' + nBoards + ' boards)';
		}
		
		html += `<div><input type="checkbox" class="checkbox" id="${p}">` + '\n';
		html += `<label for="${p}">` + desc + '</label></div>' + '\n\n';
	}
	html += '</div>' + '\n\n';
	
	return html;
}

async function lin2d(lin) {
	// Build a "standard" deal structure from a LIN string.
	// Alas it is not so "standard", a problem to clean up later.

	let d = {};
	d.lin = lin;
	d.name = lin.match( /pn\|[^|]*/ )[0].substr(3).split(',');
	d.hand = linboard2dotboard( lin2hands(lin) );
	
	// boardhtml() needs this packing
	d.deal = d.hand[1] + ':' + d.hand[2] + ':' + d.hand[3] + ':' + d.hand[0];
	
	// BBO seems to permit uppercase too for the vulnerability indication in the LIN
	// string. Made check case insensitive from 1.4.2 onward.
	const linVul = lin.match( /(?<=sv\|)[onebONEB]/ );
	d.vul = linVul !== null ? LINvul2BSOLvul[linVul[0].toLowerCase()] : 'o';
	
	// First digit after 'md|' indicates dealer (1 = South, 2 = West, ...)
	d.dealer = 'ESWN'.charAt( lin.charAt(lin.indexOf('md|') + 3) % 4 );
	
	const linBoard = lin.match( /(?<=ah\|Board\s*)\d+/ );
	d.bstr = linBoard !== null ? parseInt(linBoard[0]) : '';
	d.bnum = linBoard !== null ? parseInt(linBoard[0]) : 0;
	 
	[d.auction, d.alert] = lin2auction(lin);
	
	// Fix up auction for deal structure (uppercase + P, X, XX). Need to clean
	// up this mess some day but BBO itself isn't consistent.
	for (let j=0; j<d.auction.length; j++) {
		let call = d.auction[j].toUpperCase();
		if ( call === 'D' ) { call = 'X' } else if ( call === 'R' ) { call = 'XX'; }
		d.auction[j] = call;
	}
	
	// Adds contractLevel, contractDenom, doubled, and declarer fields
	d = contract(d); 
	
	d.cardplay = lin2cardplay(lin);
	d.nclaimed = lin2claimed(lin);
	
	// Add "hcp" and "whohas" fields.
	d = dealHCP(d);
	
	// For good responsiveness, only include double dummy table if cached (2nd param), 
	// unless user always wants double dummy table.
	const bCacheOnly = !pref.sessDoubleDummyAlways;
	const dd = await doubledummy(d, bCacheOnly, undefined, pref.sessDoubleDummyAlways);
	if (dd) { d.dd = dd; }

	// Get timing information (if available). Keyed by hand-bbohandle for
	// one of seats (don't know which).
	const dealTiming = await getDealTiming(d.hand, d.name);

	if (dealTiming !== undefined) {
		d.auctionTimes = dealTiming.auctionTimes;
		d.playTimes = dealTiming.playTimes;
	}

	return d;
}

function fetchdeals(ids, dv, callback) {
	let maxConnections = 8;
	let nFailed = 0;
	let nFetched = 0;
	
	let nhands = ids.length;
	let nInitial = nhands < maxConnections ? nhands : maxConnections;
	
	let linset = {};
	
	// Announce start of fetch
	dv.innerText = browser.i18n.getMessage('fetching_LIN');
	
	dv.style = 'position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; ' + 
		'background: #f0f0f0; border: solid 1px black; color: blue; width: 12em; ' + 
		'font-size: 150%; font-family: sans-serif';
	
	document.body.appendChild(dv);
	
	// Center the dialog.
	dv.style.left = ( (window.innerWidth - dv.offsetWidth)   / 2) + 'px';
    dv.style.top  = ( (window.innerHeight - dv.offsetHeight) / 2) + 'px';
	
	// Should check if individual items are cached but in practice all boards from a session
	// are likely to be cached.
	let allCached = true;
	for (let i=0; i<nhands; i++) {
		let myhand = ids[i];
		if ( app.linsetCache[myhand] === undefined ) { allCached = false; break; }
		linset[myhand] = app.linsetCache[myhand];
	}
	
	if (allCached) {
		callback(ids, linset);
		return;
	}
	
	// Launch the first set of XMLHttpRequest() calls.
	let ixFetch = nInitial - 1;
	for (let i=0; i<nInitial; i++) { myhand2lin( ids[i] ); }
	
	function myhand2lin(myhand) {		
		let url = 'https://webutil.bridgebase.com/v2/mh_handxml.php?id=' + myhand;
		
		let xhr = new XMLHttpRequest();
		xhr.timeout = 5000; // 5 seconds
		
		// Fetch asynchronously (third parameter).
		xhr.open("get", url, true);
		xhr.addEventListener('loadend', XHTTPcompletion);
		xhr.send();
	}
		
	async function XHTTPcompletion(e) {			
		// Bump immediately to minimize any race conditions.
		ixFetch++;
		nFetched++;
		
		// Immediately request the LIN for the next hand.
		if (ixFetch < nhands) {	 myhand2lin( ids[ixFetch] );  }
		
		parseResponse(e);
		
		if (nFetched !== nhands) { return; }
		
		// console.log(linset);
		callback(ids, linset);
	}
	
	function parseResponse(e) {
					
		let url = e.target.responseURL;
		let status = e.target.status;
		if (status !== 200) { 
			console.warn('BBO Helper: myhand to LIN query returned HTTP code', 
				status, 'for URL', url);
			nFailed++;
			return;
		}
		
		let response = e.target.response;
		
		let msg = nFetched + ' ' + browser.i18n.getMessage('LIN_boards_fetched');
		if (nFailed) { msg += ` (${nFailed} failed)`; }
		dv.innerText = msg;
		
		const parser = new DOMParser();
		let doc;
		
		try { doc = parser.parseFromString(response, "application/xml"); }
		catch (ec) {
			console.warn('BBO Helper: myhand to LIN query response parsing failed', 
				response, ec);
			nFailed++;	
			return;
		}
		
		const l = doc.getElementsByTagName('lin')[0];
		const err = l.getAttribute('err');
		if ( err === "0" ) {
			let lin = l.innerHTML;
			
			// Trim any trailing newline.
			if ( lin.endsWith("\n") ) { lin = lin.substring(0, lin.length-1); }
			
			// Correct BBO mangling of suit symbol encoding.
			lin = encodedSuitFix(lin); 

			const result_id = l.getAttribute('id');
			const when_played = parseInt(l.getAttribute('when_played'));
			
			const ix = url.search('id=');
			const id = url.substr(ix+3);
			
			linset[id] = {lin, result_id, when_played};
			app.linsetCache[id] = linset[id];
		}
		else {
			nFailed++;
			console.warn('BBO Helper: myhand to LIN query returned BBO err', err, 
				'for URL', url);
		}
	}

}


function windowMessage(message, timeout) {
	// Display a brief message centered on the screen.
	
	if (timeout === undefined) { timeout = 1500; }
	
	let dv = document.createElement('div');
	dv.innerText = message;
	
	dv.style = 'position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; ' + 
		'background: #f0f0f0; border: solid 1px black; color: blue; width: 12em; ' + 
		'font-size: 150%; font-family: sans-serif';
	
	document.body.appendChild(dv);
	
	dv.style.left = ( (window.innerWidth - dv.offsetWidth)   / 2) + 'px';
    dv.style.top  = ( (window.innerHeight - dv.offsetHeight) / 2) + 'px';
	
	setTimeout(() => { dv.remove(); }, timeout);
}
