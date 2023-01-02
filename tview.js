/*
 * Add field strength calculation to tournament results display.
 * 
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
*/

"use strict";

// For Manifest V3, move away from using a polyfill
if ( isChromium() ) { var browser = chrome; };

function isChromium() {
	// navigator.userAgentData.brands is the seemingly clean way because it includes
	// brands for both 'Chrome' (etc) and 'Chromium', however Firefox does not yet
	// implement navigator.userAgentData and it is not exposed in Chromium for 
	// insecurely served pages, so provide a fallback mechanism.
	
	return navigator.userAgentData ? 
		navigator.userAgentData.brands.some(data => data.brand === 'Chromium') :
		navigator.userAgent.search('Firefox') === -1;
}

// VAR not LET because APP is referenced in common.js. This primarily used in the 
// for the BBO application (bbov3.js) and standalone BBO Handviewer (handviewer.js)
// but we include it here too to prevent issue when app.prefLoaded is set
var app = {};

let allbbohandles = [];
let sc = document.getElementsByClassName('sectiontable');

for (let i=0; i<sc.length; i++) {
	let teams = sc[i].getElementsByClassName('username');
	for (let j=0; j<teams.length; j++) {
		let players = teams[j].innerHTML.toLowerCase().split('+');
		allbbohandles.push(...players);
	}
}

browser.runtime.sendMessage(
	{'type': 'fs+names', 'bbohandles': allbbohandles} ).then(fsResponse);

// Give page a more informative title than just "Result".
improveTitle();

function fsResponse(data) {	
	addFieldStrength(data);
	addLeaderNames(data.players);
	addSectionNames(data.players);
}

function improveTitle() {
	const el = document.getElementsByClassName('bbo_t_l')[0];
	if (el === undefined) { return; }   // Guard against BBO changes
	
	// Find correct <tr> in <tbody> of <table>. Need to be careful because for BBO Events
	// (as opposed to say ACBL events), BBO stuffs a logo and a spacer in <td> elements
	// with rowspan=9 (it's horrible HTML)
	const tds = el.children[0].getElementsByClassName('bbo_tlv');
	if (tds.length === 0) { return; }   // Guard against BBO changes
	
	// Grab the tournament name title, e.g. '#24714 ACBL Open-Pairs...''
	let tourneyName = tds[0].innerText;
	
	document.title = 'Results for ' + tourneyName;
}

function addFieldStrength(data) {
	
	// Field strength was already added by BBO Helper. This should only
	// happen during testing when BBO Helper add-on is reloaded.
	let elfs = document.getElementById('bbo-helper-fs');
	if (elfs !== null) { elfs.remove(); }
	
	let el = document.getElementsByClassName('bbo_t_l')[0];
	if (el === undefined) { return; }   // Guard against BBO changes.
	
	// The sloppy BBO HTML doesn't include the <tbody> element, but it gets
	// added to the DOM when the HTML is parsed.
	const tds = el.children[0].getElementsByClassName('bbo_tlv');
	if (tds.length === 0) { return; }   // Guard against BBO changes

	elfs = document.createElement('tr');
	elfs.id = 'bbo-helper-fs';
	let fsrow = tds[0].parentNode.insertAdjacentElement('afterend', elfs);

	let fstxt;
	if (data.cnt === 0) {
		fstxt = browser.i18n.getMessage('no_ABCL_players');
	}
	else {
		fstxt = parseInt(data.fieldStrength) + ' MP, estimated from ' + 
			data.cnt + ' ACBL players (' + parseInt(100 * data.cnt/allbbohandles.length) + 
			'% of field)';
	}
	let html = '<td class="bbo_tll" align="left">Strength</td><td>' + fstxt + '</td>';

	fsrow.innerHTML = html;
}

function addLeaderNames(players) {
	let div = document.getElementsByClassName('bbo_tr_o');
	if (div.length === 0) { return; }  // Guard
	let table = div[0].getElementsByTagName('table')[0];
	if (!table) { return; } // Guard
	
	let colname = browser.i18n.getMessage('player_names');
	
	// The sloppy BBO HTML doesn't include the <tbody> element, but it gets
	// added to the DOM when the HTML is parsed.
	let tr = table.children[0].children;
	let td = tr[0].children;
	let ncols = td.length;
	
	if ( td[td.length-1].innerHTML !== colname ) {
		let el = document.createElement('th');
		el.innerHTML = colname;
		tr[0].appendChild(el);
		ncols++;
	}
	
	for (let j=1; j<tr.length; j++) {
		// Bail if we already add the column (development situation)
		if ( tr[j].children.length === ncols) { break; }
		
		// BBO handles are in the second column on leader table.
		let bbohandles = tr[j].children[1].innerHTML.toLowerCase().split('+');

		let nfound = 0; let playerList = '';
		for (let k=0; k<bbohandles.length; k++) {
			let name = players[ bbohandles[k] ];

			if (k) { playerList += ' - '; }
			playerList += (name === undefined) ? '?' : name;
			if (name !== undefined) { nfound++; }
		}

		let el = document.createElement('td');
		if (nfound) { el.innerHTML = playerList; }
		tr[j].appendChild(el);
	}		

}

function addSectionNames(players) {
	let sc = document.getElementsByClassName('sectiontable');
	
	let colname = browser.i18n.getMessage('player_names');
	
	for (let i=0; i<sc.length; i++) {
		// The sloppy BBO HTML doesn't include the <tbody> element but DOM has it.
		let tr = sc[i].children[0].children;
		let td = tr[0].children;
		let ncols = td.length;
		
		if ( td[td.length-1].innerHTML !== colname ) {
			let el = document.createElement('th');
			el.innerHTML = colname;
			tr[0].appendChild(el);
			ncols++;
		}
		
		for (let j=1; j<tr.length; j++) {
			// Bail if we already added the column (reloading add-on).
			if ( tr[j].children.length === ncols) { break; }
			
			// BBO handles are in first column in section tables.
			let bbohandles = tr[j].children[0].innerHTML.toLowerCase().split('+');

			let nfound = 0; let playerList = '';
			for (let k=0; k<bbohandles.length; k++) {
				let name = players[ bbohandles[k] ];

				if (k) { playerList += ' - '; }
				playerList += (name === undefined) ? '?' : name;
				if (name !== undefined) { nfound++; }
			}

			let el = document.createElement('td');
			if (nfound) { el.innerText = playerList; }
			tr[j].appendChild(el);
		}		

	}
}