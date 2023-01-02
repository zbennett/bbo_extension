/* Programmatically populate the options and respond to changes.
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
*/

"use strict";

let isChrome = isChromium();

// For Manifest V3, move away from using a polyfill
if (isChrome) { var browser = chrome; };

function isChromium() {
	// navigator.userAgentData.brands is the seemingly clean way because it includes
	// brands for both 'Chrome' (etc) and 'Chromium', however Firefox does not yet
	// implement navigator.userAgentData and it is not exposed in Chromium for 
	// insecurely served pages, so provide a fallback mechanism.
	
	return navigator.userAgentData ? 
		navigator.userAgentData.brands.some(data => data.brand === 'Chromium') :
		navigator.userAgent.search('Firefox') === -1;
}

// Firefox sizes the options well, but Chrome needs help.
if (isChrome) { document.body.style = "width: 36em"; }

// Define the order of the option in each category. By default options are
// assumed to be boolean check boxes (exceptions are defined below).
const options = {
	"app": ["appShowAuctionClock", "appShowPlayClock", "appDoubleDummyMode",
		"hvDoubleDummyMode", "appDoubleDummyTricks", "appAutoAlerts",
		"appAlertSubstitutions", "appChatNameSubs", "appChatAutoSuits", 
		"appClaimAutoSuits", "appShowPeopleTooltip", "appBoardLocalization",
		"travSuitFourColor", "sessDoubleDummyAlways"],
		
	"cards": ["cardUse10", "handVoidmdash", "suitFourColor", "suitForceBlack"],
	
	"board_full": ["boardIncludeBorder", "boardShowTiming", "boardIncludeNames",
		"boardPlayerNameMode", "boardShowAuction", "boardShowContract",
		"boardShowHCP", "boardShowDateTime", "boardShowDoubleDummy",
		"boardShowPlay", "boardShowExplanations", "boardHideRobotExplanations",
		"boardShowLinks", "boardLinksTargetBlank"],
		
	"board_partial": ["boardPartialShowBoardNumber", "boardPartialShowContract"],
	
	"auction": ["auctionTextNT", "auctionShortCalls", "auctionSeatLetters",
		"auctionHideFinalPasses", "auctionBBOstyling"],
		
	"timing": ["timingInstantAction", "timingBIT", "timimgLongBIT"],
	
	"traffic": ["appTrafficLogging", "appTrafficLogFeed", "appTrafficLoggingFull",
		"appTrafficLogHidePassword", "appTrafficMaxKilobytes"]
};

// Indicates options that take a numeric value (default is checkbox)
const isNumericOption = {"appTrafficMaxKilobytes": true, "timingInstantAction": true,
	"timingBIT": true, "timimgLongBIT": true};

// Defines pulldown menu for options with a menu (default is checkbox)
const pulldownMenuOption = {"boardPlayerNameMode": [ ["bbohandle", "BBO Handle"], 
	["name", "Name (if known) or BBO"], ["seat", "Compass Direction"] ]};

// Indicates options whose description include HTML. Setting innerText is
// faster. Only use innerHTML when necessary.
const isHTML = {"suitForceBlack": true};
	

// PREF handling
let pref;

browser.storage.local.get('pref').then(populate, getfail);

function getfail(err) {
	console.error("Failed to retrieve 'pref' from local storage", err);
}

document.addEventListener("change", (e) => {
	
	let id = e.target.id;
	
	if (e.target.type === 'checkbox') {	
		// Handle checkboxes change
		let checked = e.target.checked;
		
		if (id === 'appDoubleDummyMode' || id === 'hvDoubleDummyMode') {
			// Special case because we planned for three modes ('off', 'ondemand',
			// and 'always') but in practice only implemented 'off' and 'always' 
			// because BSOL response time proved to be very good.
			pref[id] = checked ? 'always' : 'off';
		}
		else if (id === 'auctionTextNT') {
			pref[id] = checked ? 'NT' : 'N';
		}
		else {
			// Routine checkbox
			pref[id] = checked;
		}
	}
	else if (e.target.type === 'select-one') {
		pref[id] = e.target.value;
	}

	else if (e.target.type === 'number') {
		let num = parseFloat( e.target.value );

		if (isNaN(num) || num < 0) {
			// Restore original value if input is unparseable or negative.
			e.target.value = pref[id]; return
		}
		// Display clean value.
		e.target.value = num;
		pref[id] = num;
	}

	// Update the preference.
	let items = { pref };
	browser.storage.local.set(items);
});


function populate(items) {
	// Programatically populate the different option sections. They are mostly
	// checkboxes.
	
	// Populate option categories.
	let sc = document.getElementsByClassName('i18n');
	for (let i=0; i<sc.length; i++) {
		let msg = browser.i18n.getMessage('options_section_' + sc[i].getAttribute('id'));
		sc[i].innerText = msg;
	}
	
	pref = items['pref'];
	
	for (let ix=0; ix<sc.length; ix++) {
		let section = sc[ix].getAttribute('id');
		
		let el = document.createTextNode('\n\n');
		sc[ix].after(el);
		
		let opt = options[section];
		if (opt === undefined) {
			console.warn('BBO Helper: No options found for section', section);
			continue;
		}
		
		for (let i=0; i<opt.length; i++) {
			let p = opt[i];
			let desc = browser.i18n.getMessage('options_' + p);
			if (desc === "") {
				isHTML[p] = true;
				desc = '<span style="color: red">' + 
					'Language file is missing transation for message id ' +
					'options_' + p + '</span>';
			}
			
			if ( pulldownMenuOption[p] !== undefined ) {
				// Pulldown menu of options
				let dv = document.createElement('div');
				let sl = selectmenu(p, pulldownMenuOption[p], pref[p]);
				dv.append(sl);
				
				dv.append( document.createTextNode('\n\n') );
				el.after(dv);
				el = dv;
			}
			
			else if ( isNumericOption[p] ) {
				// Numeric input field.
				let dv = document.createElement('div');
				let nn = document.createElement('input');
				nn.setAttribute('type', 'number');
				nn.setAttribute('id', p);
				nn.value = pref[p];
				dv.append(nn);
				
				let lb = document.createElement('label');
				lb.setAttribute('for', p);
				
				// Most of the time we can use innerText which is faster.
				if ( isHTML[p] ) { lb.innerHTML = desc } else { lb.innerText = desc; }
				dv.append(lb);
				
				dv.append( document.createTextNode('\n\n') );
				el.after(dv);
				el = dv;
			}
			
			else {	
				let dv = document.createElement('div');
				
				let cb = document.createElement('input');
				cb.setAttribute('type', 'checkbox');
				cb.className = 'checkbox';
				cb.setAttribute('id', p);
				cb.checked = pref[p];
				dv.append(cb);
				
				let lb = document.createElement('label');
				lb.setAttribute('for', p);
				
				// Most of the time we can use innerText which is faster.
				if ( isHTML[p] ) { lb.innerHTML = desc } else { lb.innerText = desc; }

				dv.append(lb);
				
				if (p === 'boardIncludeNames') {
					// Want next option ("boardPlayerNameMode") to be to the right
					// of "boardIncludeNames" option.
					i++;
					let p2 = opt[i];
					let sl = selectmenu(p2, pulldownMenuOption[p2], pref[p2]);
					dv.append(sl);
				}
				
				dv.append( document.createTextNode('\n\n') );
				el.after(dv);
				el = dv;
			}
		}

	}
	
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

function insertOptions(id, opt) {
	let h2 = document.getElementById(id);
	if (!h2) {
		console.error('BBO Helper: id not found in options.html:', id);
		return;
	}
	
	let el = document.createTextNode('\n\n');
	h2.after(el);
	
	for (let i=0; i<opt.length; i++) {
		let p = opt[i].p;
		let desc = opt[i].desc;
		
		if (opt[i].menu) {
			// Pulldown menu of options
			let dv = document.createElement('div');
			let sl = selectmenu(p, opt[i].menu, pref[p]);
			dv.append(sl);
			
			dv.append( document.createTextNode('\n\n') );
			el.after(dv);
			el = dv;
		}
		
		else if (opt[i].number) {
			// Numeric input field.
			let dv = document.createElement('div');
			let nn = document.createElement('input');
			nn.setAttribute('type', 'number');
			nn.setAttribute('id', p);
			nn.value = pref[p];
			dv.append(nn);
			
			let lb = document.createElement('label');
			lb.setAttribute('for', p);
			lb.innerHTML = desc;
			dv.append(lb);
			
			dv.append( document.createTextNode('\n\n') );
			el.after(dv);
			el = dv;
		}
		
		else {	
			let dv = document.createElement('div');
			
			let cb = document.createElement('input');
			cb.setAttribute('type', 'checkbox');
			cb.className = 'checkbox';
			cb.setAttribute('id', p);
			cb.checked = pref[p];
			dv.append(cb);
			
			let lb = document.createElement('label');
			lb.setAttribute('for', p);
			lb.innerHTML = desc;
			dv.append(lb);
			
			if (p === 'boardIncludeNames') {
				// Want next option ("boardPlayerNameMode") to be to the right
				// of "boardIncludeNames" option.
				i++;
				let sl = selectmenu(opt[i].p, opt[i].menu, pref[ opt[i].p ]);
				dv.append(sl);
			}
			
			dv.append( document.createTextNode('\n\n') );
			el.after(dv);
			el = dv;
		}
	}
}

