/* 
 * Programmatically populate the Auto Alert cases options and respond to changes.
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
*/

function isChromium() {
	// navigator.userAgentData.brands is the seemingly clean way because it includes
	// brands for both 'Chrome' (etc) and 'Chromium', however Firefox does not yet
	// implement navigator.userAgentData and it is not exposed in Chromium for 
	// insecurely served pages, so provide a fallback mechanism.
	
	return navigator.userAgentData ? 
		navigator.userAgentData.brands.some(data => data.brand === 'Chromium') :
		navigator.userAgent.search('Firefox') === -1;
}

// For Manifest V3, move away from using a polyfill (normally pick this up from
// common.js but we pull in common.js for this functionality).
if ( isChromium() ) { var browser = chrome; };

let pref, aa;

browser.storage.local.get('pref').then(populate, getfail);

const MAX_BBO_ALERT_MESSAGE_LENGTH = 39;

function getfail(err) {
	console.error("Failed to retrieve 'pref' from local storage", err);
}

async function exportAlerts() {		
	// Default filename.
	saveMessage('Not implemented yet.'); return;
	
	let fname = 'BBO Helper Auto Alerts.json';
	
	// This might create data fidelity issue for times longer than >= 552.96 sec
	// due to Unicode surrogates in UTF-16 being converted to the Unicode replacement
	// character (U+FFFD). See https://developer.mozilla.org/en-US/docs/Web/API/USVString
	let blob = new Blob( [ JSON.stringify(aa) ], {type: 'application/json'});
	saveAs(blob, fname);
}

document.getElementById('exportButton').addEventListener("click", exportAlerts);

document.getElementById('saveButton').addEventListener("click", () => {
	// Save the current Auto Alert settings
	
	// Reload PREF in case the other options have been changed since user brought
	// up the Auto Alerts editor.
	browser.storage.local.get('pref').then(saveAlertsCB, getfail);

	function saveAlertsCB(items) {
		// Executed after PREF has been fetched from local storage.
		pref = items['pref'];
	
		pref.aa = aa;
		items = { pref };
		browser.storage.local.set(items);
		
		saveMessage('Auto Alert Settings Saved');
	}
});

document.addEventListener("change", (e) => {
	
	let id = e.target.id;
	
	if (e.target.type === 'text') {
		// Common case
		let alert = e.target.value.trim();
		e.target.value = alert;
		
		if ( id.startsWith('opening-') || id.startsWith('nt-') || id.startsWith('ntdef-')) {
			// Alert for opening bid, response to 1NT, or defense to 1NT was updated.
			let [type, call] = id.split('-');

			if (alert === '') { delete aa[type][call]; }
			else { aa[type][call] = alert; }
		}
		
		else {
			// Top level auto alert
			if (alert === '') { delete aa[id] } else { aa[id] = alert; }
		}

	}
	
	else if (e.target.type === 'checkbox') {
		// Handle checkbox changes
		let checked = e.target.checked;
		
		if (id === 'JacobyTransfers' || id === 'TexasTransfers') {
			// Special case, part of 1NT response section.
			aa.nt[id] = checked;
		}
		else {
			// Checkbox for top-level setting.
			aa[id] = checked;
		}
	}
	
	else if (e.target.type === 'select-one') {
		let value = e.target.value;
		
		if ( id.startsWith('directCueBid') || id.startsWith('jump2NT') ) {
			if ( id.endsWith('-style') ) {
				let [aaid, style] = id.split('-');
				aa[aaid][style] = value;
			}
			else {
				aa[id]['type'] = value;
			}
		}
		
		else {
			// Ordinary top level menu (e.g. for "1NT after 1M" or "2NT response to Weak Two")
			aa[id] = value;
		}
	}
	
});

function populate(items) {
	// Do the localization first
	let h2a = document.getElementsByTagName('H2');
	for (let i=0; i<h2a.length; i++) {
		let msg = browser.i18n.getMessage( 'alert_section_' + h2a[i].getAttribute('id') );
		h2a[i].innerText = msg;
	}
	
	let lz = document.getElementsByClassName('i18n');
	for (let i=0; i<lz.length; i++) {
		let msg = browser.i18n.getMessage( 'alert_' + lz[i].getAttribute('id') );
		
		// innerText is faster than innerHTML but sometimes we have HTML to insert.
		if ( lz[i].classList.contains('needsHTML') ) { lz[i].innerHTML = msg; }
		else { lz[i].innerText = msg; }
	}
	
	// Programmatically populate the different option sections. They are mostly
	// checkboxes.
	
	aa = items['pref'].aa;
	let el, h2, dv, lb, sb;
	
	// Opening bids
	h2 = document.getElementById('opening');
	el = newlines(h2);
	
	let denom = 'CDHSN';
	let denomHTML = ['&clubs;', '<span class="ds">&diams;</span>', 
		'<span class="hs">&hearts;</span>', '&spades;', 'NT'];
		
	for (let level=1; level<4; level++) {
		for (let i=0; i<denomHTML.length; i++) {
			let bid = level.toString() + denom.charAt(i);
			let bidHTML = level.toString() + denomHTML[i];
			let dv = divExplainCall(bid, bidHTML, 'opening');
			el.after(dv);
			el = dv;
				
			if (bid === '1N') {
				// Separate line for opening 1NT when vulnerable
				let dv = divExplainCall(bid, bidHTML, 'opening', 'opening-1NTvul');
				el.after(dv);
				el = dv;
			}
			
			else if (bid === '2S') {
				// Line for 2D/2H/2S in fourth seat
				let label = '<span style="font-size: 120%">' + '2' + denomHTML[1] + '/' +  
					denomHTML[2] + '/' + denomHTML[3] + '</span>' + ' in fourth seat';
				dv = divExplain(label, 'opening-FourthSeat2Bid');
				el.after(dv);
				el = dv;
			}
		}
	}
	
	// Non-competitive responses
	h2 = document.getElementById('responses');
	el = newlines(h2);
	
	// Non-competitive: 1M 1N
	dv = document.createElement('div');
	
	let forcingNTmenu = [ ["forcing", "Forcing"], ["non-forcing", "Not Forcing"],
		["semi", "Semi-Forcing"], ["semi-passed", "Semi-Forcing by Passed Hand"] ];
	
	lb = document.createElement('label');
	lb.setAttribute('for', 'forcingNT');
	lb.setAttribute('id', 'forcingNT-label');
	lb.innerHTML = `1NT after 1${denomHTML[2]}/1${denomHTML[3]}:`;
	dv.append(lb);	
	
	sb = selectmenu('forcingNT', forcingNTmenu, aa.forcingNT);
	dv.append(sb);
	el.after(dv);
	el = dv;
	
	// Non-competitive: Major suit jump raise
	dv = divExplain("Major Suit Jump Raise:", "majorJumpRaise");
	el.after(dv);
	el = dv;
	
	// Non-competitive: Splinters and Jacoby 2NT
	dv = document.createElement('div');
	dv.innerHTML = 
		'<label for="majorSplinters">Splinters (Double Jump)</label>' +
		'<input type="checkbox" id="majorSplinters">' +
		'<label class="indent2" for="Jacoby2NT">Jacoby 2NT</label>' +
		'<input type="checkbox" id="Jacoby2NT">';
	el.after(dv);
	el = dv;
	
	document.getElementById('majorSplinters').checked = aa['majorSplinters'];
	document.getElementById('Jacoby2NT').checked = aa['Jacoby2NT'];
	
	// Non-competitive: Inverted Minors
	dv = document.createElement('div');
	dv.innerHTML = '<label for="invertedMinors">Inverted Minors</label>' +
	 '<input type="checkbox" id="invertedMinors">';
	el.after(dv);
	el = dv;
	
	document.getElementById('invertedMinors').checked = aa['invertedMinors'];
	
	// Non-competitive: Minor suit jump raise
	dv = divExplain("Minor Suit Jump Raise:", "minorJumpRaise");
	el.after(dv);
	el = dv;
	
	// Non-competitive: 1x 2y jump response
	dv = divExplain("1x 2y Jump response:", "OneTwoJumpResponse");
	el.after(dv);
	el = dv;

	// Non-competitive: 2NT response to a Weak Two opener
	dv = document.createElement('div');
	
	let weak2NTmenu = [ ["feature", "Feature Asking"], ["OGUST", "OGUST"],
		[undefined, "Natural"], ];
	
	lb = document.createElement('label');
	lb.setAttribute('for', 'weak2NT');
	lb.setAttribute('id', 'weak2NT-label');
	lb.innerHTML = `2NT response to a Weak Two Opener:`;
	dv.append(lb);	
	
	sb = selectmenu('weak2NT', weak2NTmenu, aa.weak2NT);
	dv.append(sb);
	el.after(dv);
	el = dv;	
		
	// Responses to 1NT
	h2 = document.getElementById('nt_responses');
	el = newlines(h2);
	
	// Commonly played transfer responses.
	dv = document.createElement('div');
	dv.innerHTML = 
		'<label class="indent1" for="JacobyTransfers">Jacoby Transfers</label>' +
		'<input type="checkbox" id="JacobyTransfers">' +
		'<label class="indent2" for="TexasTransfers">Texas Transfers</label>' +
		'<input type="checkbox" id="TexasTransfers">';
	el.after(dv);
	el = dv;
	
	document.getElementById('JacobyTransfers').checked = aa.nt['JacobyTransfers'];
	document.getElementById('TexasTransfers').checked = aa.nt['TexasTransfers'];
	
	// 1NT responses with move diversity of meaning
	let ntbids = ['2S', '2N', '3C', '3D', '3H', '3S'];
	for (let i=0; i<ntbids.length; i++) {
		let bid = ntbids[i];
		let ix = denom.indexOf( bid.charAt(1) );
		let bidHTML = bid.charAt(0) + denomHTML[ix];
		let dv = divExplainCall(bid, bidHTML, 'nt');
		el.after(dv);
		el = dv;
	}
	
	// Defense to an opening 1NT bid
	h2 = document.getElementById('nt_defense');
	el = newlines(h2);
	
	let ntdefcalls = ['d', '2C', '2D', '2H', '2S', '2N'];
	for (let i=0; i<ntdefcalls.length; i++) {
		let call = ntdefcalls[i];
		let ix = denom.indexOf( call.charAt(1) );
		let callHTML = call === 'd' ? 'Dbl' : call.charAt(0) + denomHTML[ix];
		let dv = divExplainCall(call, callHTML, 'ntdef');
		el.after(dv);
		el = dv;
	}
	
	// Other bidding scenarios
	h2 = document.getElementById('other');
	el = newlines(h2);

	// Other bidding scenarios: Notrump Overcalls
	dv = divExplain("1NT overcall:", "NTovercall");
	el.after(dv);
	el = dv;
	
	// Other bidding scenarios: Balancing Notrump
	dv = divExplain("Balancing 1NT:", "NTbalancing");
	el.after(dv);
	el = dv;
	
	const twoSuitBids = ['directCueBid', 'jump2NT'];
	
	for (let i=0; i<twoSuitBids.length; i++) {
		let id = twoSuitBids[i];
		dv = document.createElement('div');
		
		let menu; 
		if (id === 'directCueBid') { 
			menu = [ ["Michaels", "Michaels"], ["Top and Bottom", "Top and Bottom"],
			[undefined, "Unspecified"] ];
		}
		else if (id === 'jump2NT') {
			menu = [ ["Two Lowest", "Two Lowest Unbid"], ["Minors", "Minors"],
			[undefined, "Unspecified"] ];	
		}
		
		lb = document.createElement('label');
		lb.setAttribute('for', id);
		lb.setAttribute('id', `${id}-label`);
		lb.className = 'pulldown';
		lb.innerHTML = id === 'directCueBid' ? 'Direct Cue Bid:' : 'Jump to 2NT:';
		dv.append(lb);
		
		sb = selectmenu(id, menu, aa[id]['type']);
		dv.append(sb);
		
		// Convention style pulldown. Label doesn't fit (might rework UI)
		let style_id = id + '-style';
		let showStyleLable = false;
		if (showStyleLable) {
			lb = document.createElement('label');
			lb.setAttribute('for', style_id);
			lb.setAttribute('id', `${style_id}-label`);
			lb.className = 'conv-style';
			lb.innerHTML = 'style';
			dv.append(lb);
		}
		
		const style_menu = [ ['5-5', '5-5 or better'], ['5-4', '5-4 or better'],
			['5-4-not22', '5-4 or better (5-4-2-2 rare)'], 
			['5-4-NV', '5-5 or better Vul, 5-4 or better NV' ],
			['5-4-NV-not5422', '5-5 (V) / 5-4 (NV) or better (5-4-2-2 rare)'] ];
			
		sb = selectmenu(style_id, style_menu, aa[id]['style']);
		dv.append(sb);
		
		el.after(dv);
		el = dv;
	}
	
	function divExplainCall(call, callHTML, type, id) {
		
		// ID is normally undefined and contstructed
		if (id === undefined) { id = type + '-' + call; }
		let dv = document.createElement('div');
		
		let lb = document.createElement('label');
		lb.setAttribute('for', id);
		lb.className = 'call';
		lb.innerHTML = callHTML;
		dv.append(lb);
		
		let tx = document.createElement('input');
		tx.setAttribute('type', 'text');
		tx.setAttribute('id', id);
		tx.setAttribute('maxlength', MAX_BBO_ALERT_MESSAGE_LENGTH);
		if (id === 'opening-1NTvul') {
			// One off exception for vulnerable 1NT range (when different)
			tx.value = aa[type]['1NTvul'] === undefined ? '' : aa[type]['1NTvul'];
		} else {
			// Normal case
			tx.value = aa[type][call] === undefined ? '' : aa[type][call];
		}
		dv.append(tx);
		
		if (id === 'opening-1NTvul') {
			let sp = document.createElement('span');
			sp.style = 'padding-left: 0.8em';
			sp.innerHTML = '(if different when Vul)';
			dv.append(sp);
		}
		
		// Not really needed but it makes View Source look nicer.
		dv.append( document.createTextNode('\n\n') );

		return dv;
	}
	
	function divExplain(label, id) {
		let dv = document.createElement('div');
		
		let lb = document.createElement('label');
		lb.setAttribute('for', id);
		lb.setAttribute('id', id + '-' + 'label');
		lb.className = 'explain';
		lb.innerHTML = label;
		dv.append(lb);
		
		let tx = document.createElement('input');
		tx.setAttribute('type', 'text');
		tx.setAttribute('id', id);
		tx.setAttribute('maxlength', MAX_BBO_ALERT_MESSAGE_LENGTH);
		if (id === 'opening-FourthSeat2Bid') {
			// One off exception
			let str = aa['opening']['FourthSeat2Bid'];
			tx.value = str === undefined ? '' : str;
		}
		else {
			// Normal case
			tx.value = aa[id] === undefined ? '' : aa[id];
		}
		dv.append(tx);
		
		// Not really needs but it makes View Source look nicer.
		dv.append( document.createTextNode('\n\n') );

		return dv;
	}	
	
	function selectmenu(id, menuitems, initialValue) { 
	
		let selectBox = document.createElement('select');
		selectBox.setAttribute('id', id);
		
		for (let j=0; j<menuitems.length; j++) {
			let op = document.createElement('option');
			op.value = menuitems[j][0];
			op.innerHTML = menuitems[j][1];
			if (op.value === initialValue) {
				op.setAttribute('selected', '');
			}
			selectBox.append(op);
		}
		
		return selectBox;
	}

	function newlines(h2) {
		let el = document.createTextNode('\n\n');
		h2.after(el)
		return el;
	}	
}

function saveMessage(msg) {
	// Display a brief message confirming the save.
	
	let dv = document.createElement('div');
	dv.innerText = msg;
	
	dv.style = 'position: fixed; padding: 0.2em 0.5em 0.2em 0.5em; border-radius: 7px; ' + 
		'background: #f0f0f0; color: blue; width: 8em; ' + 
		'font-size: 150%; font-family: sans-serif';
	
	document.body.appendChild(dv);
	
	let el = document.getElementById('saveButton');

	dv.style.left = ( el.offsetLeft + (el.offsetWidth - dv.offsetWidth) / 2) + 'px';
    dv.style.top  = ( el.offsetTop - el.offsetHeight - dv.offsetHeight - 10 ) + 'px';
	
	setTimeout(() => { dv.remove(); }, 1500);
}
