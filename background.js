/* 
 * Support operations on the static player database
 *
 * Implement this as a background script to avoid possible duplication in memory
 * of a decent sized database. 
 *
 * BBO Helper browser add-on (Matthew Kidd, San Diego)
*/

import pdata from "./playerdb.js"

browser.runtime.onMessage.addListener(handler);

async function handler(msg) {

	if (msg.type === 'lookup') {
		let data;
		let bbohandle = msg.bbohandle.toLowerCase();
		let p = pdata[bbohandle];
		if (p) {
			data = {'bbohandle': bbohandle, 'fullname': p[0], 'state': p[1], 
				'mp': p[3]};
		}
		else {
			data = {'bbohandle': bbohandle, 'lookupfail': true};
		}
		return new Promise( (resolve) => {resolve(data)} );
	}

	if (msg.type === 'lookup_many') {
		const data = { 'bbohandle': [], 'fullname': [], 'state': [], 'mp': [], 'fail': [] };
		
		for (let i=0; i<msg.bbohandle.length; i++) {
			const bbohandle = msg.bbohandle[i].toLowerCase();
			const p = pdata[bbohandle];
			
			data.fail.push(p === undefined);
			data.bbohandle.push( bbohandle );
			data.fullname.push( p ? p[0] : undefined );
			data.state.push( p ? p[1] : undefined );
			data.mp.push( p ? p[3] : undefined );
		}
		return new Promise( (resolve) => {resolve(data)} );
	}

	if (msg.type === 'vugraph_name') {	
		const url = 'https://webutil.bridgebase.com/v2/evp.php' + 
			'?voe=' + encodeURIComponent(msg.vgPresenter) + 
			'&u=' + encodeURIComponent(msg.name);
			
		// A service worker isn't allowed to access to the DOM and unfortunately
		// this include DOMParser(). Instead of doing sloppy parsing here (or 
		// folding in the third party XML parsing library like tXml (see
		// https://github.com/tobiasnickel/tXml), just send the full HTML back.
		// https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/

		return fetch(url)
			.then( (response) => response.text() )
			.then( (html) => new Promise( (resolve) => {resolve(html)} ) )
			.catch( (error) => {
				console.warn('Failed processing URL:', url, 'error:', error);
				return new Promise( (resolve) => {resolve('')} );
			});
	}
		
	else if (msg.type === 'fs+names') {
		let players = {};
		let cnt = 0;
		let mpLogTotal = 0;
		const bbohandles = msg.bbohandles;
		for (let i=0; i<bbohandles.length; i++) {
			let bbohandle = bbohandles[i];
			const p = pdata[ bbohandle ];
			if (!p) { continue; }
			
			let state = p[1] === '' ? '' : ' (' + p[1] + ')';
			players[ bbohandle ] = p[0] + state;
			
			let mp = p[3];
			if (mp === -1) { continue; }
			if (mp < 1) { mp = 1; }
			
			cnt++;
			mpLogTotal += Math.log(mp);
		}
			
		const fieldStrength = cnt === 0 ? undefined : Math.exp(mpLogTotal/cnt);
		let data = {'cnt': cnt, 'fieldStrength': fieldStrength, 'players': players};
		return new Promise( (resolve) => {resolve(data)} );
	}

	else if (msg.type === 'fieldstrength') {
		// Not using this "API" any more. But keep it for now.
		
		let cnt = 0;
		let mpLogTotal = 0;
		const bbohandles = msg.bbohandles;
		for (let i=0; i<bbohandles.length; i++) {
			const p = pdata[ bbohandles[i] ];
			if (!p) { continue; }
			let mp = p[3];
			if (mp === -1) { continue; }
			if (mp < 1) { mp = 1; }
			
			cnt++;
			mpLogTotal += Math.log(mp);
		}
			
		const fieldStrength = cnt === 0 ? undefined : Math.exp(mpLogTotal/cnt);
		let data = {'cnt': cnt, 'fieldStrength': fieldStrength};
		return new Promise( (resolve) => {resolve(data)} );
	}
}

