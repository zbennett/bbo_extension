/* Handle actions invoked from the popup menu
 *  - Transition to About screen
 *  - Transition to Quick Settings screen
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
*/

"use strict";

let pref;

let isChrome = isChromium();

// For Manifest V3, move away from using a polyfill
if (isChrome) { var browser = chrome; };

// Determine language (for sizing). Note: convert regional locale designations 
// such as 'es-419' (Latin America and Caribbean region) to 'es'.
let lang = navigator.language;
if ( lang.indexOf('-') !== -1 ) { lang = lang.substring(0, lang.indexOf('-')) }

function isChromium() {
	// navigator.userAgentData.brands is the seemingly clean way because it includes
	// brands for both 'Chrome' (etc) and 'Chromium', however Firefox does not yet
	// implement navigator.userAgentData and it is not exposed in Chromium for 
	// insecurely served pages, so provide a fallback mechanism.
	
	return navigator.userAgentData ? 
		navigator.userAgentData.brands.some(data => data.brand === 'Chromium') :
		navigator.userAgent.search('Firefox') === -1;
}

// Firefox sizes the popup menu automatically, but Chrome needs help.
if (isChrome) {
	// This isn't a scalable solution to problem of Alt+ <span> rolling to next line.
	// Will do something better later.
	const width = (lang === 'es') ? 23 : (lang === 'it') ? 17.5 : 16;
	document.body.style = `width: ${width}em`;
}
else {
	// Spanish is wordy and seems to need help on Firefox.
	if (lang === 'es') { document.body.style = 'width: 23em'; }
}

localize();

function localize() {
	// Localize the main menu
	let elMenu = document.getElementsByClassName('i18n');
	for (let i=0; i<elMenu.length; i++) {
		let el = elMenu[i];
		let id = el.tagName === 'DIV' ? el.getAttribute('id') : 
			el.tagName === 'SPAN' || el.tagName === 'A' ? el.parentElement.getAttribute('id') : 
			undefined;
		
		if (id === undefined) {
			console.warn('Found a menu element with i18n that is not a <div>, <span>, or <a>.');
			continue;
		}

		let msg = 'menu_' + id;
		el.innerText = browser.i18n.getMessage(msg);
	}
}

// Handler for menu items.
document.addEventListener("click", (e) => {
	
	if (e.target.type === 'checkbox') {
		// Handle checkboxes from the Quick Settings replacement of the menu.
		let id = e.target.id;
		if (id === 'showddBBO') {
			// Special case because we planned for three modes ('off', 'ondemand',
			// and 'always') but in practice only implemented 'off' and 'always' 
			// because BSOL response time proved to be very good.
			pref['appDoubleDummyMode'] = e.target.checked ? 'always' : 'off';
		}
		else if (id === 'showddHV') {
			// Similar case, but for the Hand Viewer
			pref['hvDoubleDummyMode'] = e.target.checked ? 'always' : 'off';
		}
		else {
			// Routine checkbox
			pref[id] = e.target.checked;
		}
		
		// Update the preference.
		let items = { pref };
		browser.storage.local.set(items).then(null, err => {
			console.error('BBO Helper: failed to update PREF', err);	
		});
		
		return;
	}
	
	// If click was on a <span> element for an "Alt+" hot key indicator, refer to 
	// parent <div>
	const el =  e.target.tagName === 'SPAN' ? e.target.parentNode : e.target;
	
	const action = el.getAttribute('data-action');
	
	if (action !== null) {
		// Menu item invokes an action in the current tab. Send a message to tab
		// to inform it to call the appropriate function. Prior to Manifest V3,
		// which clamped down on arbitrary code execution, this was done via exec()
		
		browser.tabs.query( {active: true, currentWindow: true}, function(tabs) {
  			browser.tabs.sendMessage(tabs[0].id, {'type': 'menu', 'action': action } );  			
 		});
 		window.close();
		return;
	}

	// Menu items not specific to the current tab.
	switch ( el.id ) {
		case 'about':
			showAbout();
			return;
			
		case 'quick':
			quickSettings();
			return;
			
		case 'settings':
			browser.runtime.openOptionsPage();
			window.close();
			return;
			
		case 'auto_alerts':
			let panelType = isChrome ? 'panel' : 'detached_panel';
			let h = window.screen.availHeight - 10;
			let createData = {
					type: panelType, url: 'alerts.html', width: 600, height: h, top: 5};
			browser.windows.create(createData);
			window.close();
			return;
	}
	
});


// The popup menu isn't associated with a given page. It's a background script
// But we want to customize the menu depending on the currently active page.
// Query for the tab we have displayed the menu on.
browser.tabs.query( {active: true, currentWindow: true}, tabinfo );


function tabinfo(tabs) {
	// Hide menu items that do not apply to a given page.
	
	let url = tabs[0].url;
	
	if (url === undefined) {
		console.warn("Can't access URL of current page. Should only happen when " +
			"popup menu is accessed via chrome-extension://{ext-id}/popupmenu.html");
		return;
	}
	
	// Hide "Save Traffic" item if not on BBO application page.
	if ( url.search( '//www.bridgebase.com/v3/' ) === -1 ) {
		let el = document.getElementsByClassName('bbo');
		for (let i=0; i<el.length; i++) { el[i].hidden = true; }		
	}	
	
	// Hide menu items that only apply to BBO application or standalone BBO Hand Viewer.
	// (This also removes these menu items for non-BBO pages on Chrome where the menu
	// is invoked as a brower action rather than a page action).
	if ( url.search('//www.bridgebase.com/v3/') === -1 &&
		 url.search('//www.bridgebase.com/tools/handviewer.html') === -1 ) {
		let el = document.getElementsByClassName('travhide');
		for (let i=0; i<el.length; i++) { el[i].hidden = true; }
	}
	
	// Since hot keys will not work on non-BBO pages, hide the hot key reminders
	// (Only matters on Chrome where 'page_action' menu is not supported correctly
	// in MV2 and disappears in MV3)
	if (isChrome && url.search('//www.bridgebase.com/') === -1 && 
		url.search('//webutil.bridgebase.com/') === -1 ) {
		
		let el = document.getElementsByClassName('hotkeyhint');
		for (let i=0; i<el.length; i++) { el[i].hidden = true; }
		
		// Import / export functionality does not work on non-BBO pages because
		// BBO Helper code is not loaded. Can't push off to the service worker
		// either because the service worker is not allowed to interact with the
		// DOM (so now file import / export prompts)
		el = document.getElementsByClassName('io');
		for (let i=0; i<el.length; i++) { el[i].hidden = true; }
		
		// Can make menu narrower now.
		let width = (navigator.language === 'it') ? 13 : 12;
		document.body.style = `width: ${width}em`;
	}
}

function showAbout() {
	// Replace the menu with the 'About BBO Helper' pane.
	let imgIcon = browser.runtime.getURL("icons/B++96.png");
	let appURL = 'https://lajollabridge.com/Software/BBO-Helper/';
	
	let mf = browser.runtime.getManifest();
	
	// Replace the menu with the About information.
	let iconStyle = 'float: left; margin-right: 0.8em; margin-bottom: 0.4em;';
	let slogan = browser.i18n.getMessage('about_slogan');
	let viewdoc = browser.i18n.getMessage('about_viewdoc');
	
	document.body.innerHTML = `<div style="font-family: Verdana, sans-serif">
	<img src="${imgIcon}" style="${iconStyle}" alt="BBO Helper icon" width="96" height="96"">
	<p><strong>BBO Helper</strong><br>browser<br>extension</p>
	<p>Version: ${mf['version']}</p>
	
	<p style="clear: left">${slogan}</p>
	<p>Matthew Kidd (<span style="color: blue; font-weight: bold">airglow</span> on BBO)</p>
	<p><a href="${appURL}" target="_blank">${viewdoc}</a></p>
	<p><a href="mailto:bbohelper@triplesqueeze.com">bbohelper@triplesqueeze.com</a></p>
	</div>`;
	
	// Firefox sizes the popup menu automatically, but Chrome needs help.
	if (isChrome) { document.body.style = "width: 17em"; }		
}

async function quickSettings() {
	// Replace the menu with a few frequently used settings.
	
	// We are only fetching one item from local storage but API is designed
	// to save and retrieve multiple items at once.
	let items = await browser.storage.local.get('pref');
	pref = items['pref'];
	
	let opts = ['appAutoAlerts', 'appChatAutoSuits', 'appShowAuctionClock', 
		'appShowPlayClock', 'boardShowTiming', 'suitFourColor', 'appShowPeopleTooltip',
		'appDoubleDummyTricks'];
	let ck = {};
	for (let i=0; i<opts.length; i++) {
		let opt = opts[i];
		ck[opt] = pref[opt] ? 'checked' : '';
	}
	
	// Special case because planned modes were 'always', 'ondemand', and 'off' 
	let ckddBBO = pref['appDoubleDummyMode'] === 'always' ? 'checked' : '';
	let ckddHV  = pref['hvDoubleDummyMode']  === 'always' ? 'checked' : '';
	
	// For <label> elements, "for" attribute needs to match <input> "id" attribute.
	let html = '<div id="quicksettings">' +
	'<p><strong>' + browser.i18n.getMessage('qs_title') + '</strong></p>' + "\n\n";
	
	let optOrder = ['appShowAuctionClock', 'appShowPlayClock', 'boardShowTiming',
		'suitFourColor', 'appShowPeopleTooltip', 'appAutoAlerts', 'appChatAutoSuits'];
	
	for (let i=0; i<optOrder.length; i++) {
		let opt = optOrder[i];
		let checked = ck[opt];
		html += `<input type="checkbox" id="${opt}" ${checked}>` + "\n" +
			`<label for="${opt}"> ` + browser.i18n.getMessage('qs_' + opt) + '</label><br>' +
			 "\n\n";
	}
	
	// Two special cases, then one ordinary case not worth handling in a loop as above.
	let msg = {"showddBBO": browser.i18n.getMessage('qs_showddBBO'), 
		"showddHV": browser.i18n.getMessage('qs_showddHV'),
		"appDoubleDummyTricks": browser.i18n.getMessage('qs_appDoubleDummyTricks') };
	
	html += `<input type="checkbox" id="showddBBO" ${ckddBBO}>
<label for="showddBBO"> ${msg['showddBBO']}</label><br>

<input type="checkbox" id="showddHV" ${ckddHV}>
<label for="showddHV"> ${msg['showddHV']}</label><br>

<input type="checkbox" id="appDoubleDummyTricks" ${ck['appDoubleDummyTricks']}>
<label for="appDoubleDummyTricks"> ${msg['appDoubleDummyTricks']}</label><br>
	
</div>`;
	
	document.body.innerHTML = html;
	
	// Create close "button" at the upper right.	
	const imgClose = document.createElement('img');
	imgClose.src = browser.runtime.getURL("buttons/close-button-32.png");
	imgClose.style = 'float: right; border: none';
	imgClose.addEventListener("click", () => { window.close(); }, false);
		
	const qdiv = document.getElementById('quicksettings');
	qdiv.insertAdjacentElement('beforebegin', imgClose);

	// Firefox sizes the popup menu automatically, but Chrome needs help.
	if (isChrome) {
		let lang = navigator.language;
		
		// Convert regional locale designations such as 'es-419' (Latin America 
		// and Caribbean region) to 'es'.
		const ix = lang.indexOf('-');
		if ( ix !== -1 ) { lang = lang.substring(0, ix) }
		
		const width = (lang === 'es') ? 36 : (lang === 'it') ? 30 : 24.4;
		document.body.style = `width: ${width}em`;
	}

}
