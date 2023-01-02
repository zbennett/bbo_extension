// Code that is injected into the BBO's context using chrome.scripting API
// for Manifest V3

var bh_XHR_counter = 0; // Track number of successful XHR requests;

// It's tricky sharing the preferences defining in the context of the add-on with
// the code injected into the BBO application. The PREF variable defined in the
// add-on is not visible here. If you try to pass it in a Custom Event, you can dump
// the whole thing via console.log(pref) but run into 'Error: Permission denied 
// to access property "x"' when trying to make use of it. So we pass it via a DOM
// object. We don't want to pay the JSON.parse() overhead every time we access PREF
// so keep a local copy here, and update it when a Custom Event informs us that
// it has been updated. Note: we initialize it with a few key values to prevent a
// possible race condition.
let pref = {"appSnifferConsoleLog": false, appChatAutoSuits: true};

// Listen for user preference updates
document.addEventListener('pref_update', prefUpdate);

// Request initial preferences
document.dispatchEvent( new CustomEvent("pref_request") );

// Tracks state of the app based on client-server traffic. This is independent
// of same global in bbov3.js because it's part of the injected code.
let app = {"deal": undefined, "table": undefined, "greeting": "Hi" };

const MAX_ALERT_MESSAGE_LENGTH = 39;

// Websocket code is based on https://pastebin.com/C2q7WzwB, a fix of the code in 
// the WebSocket Sniffer Firefox extension by Rinat which in turn was based on code 
// for Google Chrome: https://gist.github.com/jeffdrumgod/d2bc277658ac4d94d802b99363a7efce

WebSocket.prototype = null; // extending WebSocket will throw an error if this is not set

const bh_ORIGINAL_WEBSOCKET = WebSocket;

var WebSocket = window.WebSocket = class extends WebSocket {
	constructor(...args) {
		super(...args);
		
		var counter = 0;
		var incompleteMessage = '';
		this.consoleLogging = false;

		this.addEventListener('message', event => {				
			// Number of messages received
			counter++;
			
			// event.data is an ArrayBuffer for BBO. This is determined by the
			// websocket settings which for BBO are this.protocol is "binary"
			// and this.binaryType is "arraybuffer". This appears to be an UTF-8
			// encoded string which explains use of ArrayBuffer so parse it with
			// TextDecoder().
			const view = new Uint8Array(event.data);
			let utf8 = new TextDecoder().decode(view);
			
			// Multiple server to client messages can be pushed down in one websocket
			// message. They are separated by a NULL characters. Normally there is a
			// final NULL but if the message doesn't fit into a single websocket 
			// message (~2500 bytes here? Have seen 3050), then the last byte will be
			// not be NULL. Example: <sc_dump_fe> message if player has many friends 
			// and/or enemies.
			if (incompleteMessage.length) { 
				utf8 = incompleteMessage + utf8;
				incompleteMessage = '';
			}

			let msg = utf8.split('\x00');
			incompleteMessage = msg.pop();   // Almost always an empty string.
			
			for (let i=0; i<msg.length; i++) {
				const s = msg[i];
				if ( !s.startsWith('<sc_ack') && !s.startsWith('<sc_stats') &&
				 	!s.startsWith('<sc_feed') ) {
					if (this.consoleLogging) { console.info(counter, s); }
				}
				
				// Send a custom event that the add-on can listen for
				let ei = { detail: { "msg": msg[i] } };
				let ws_sniff = new CustomEvent("sniffer_ws_receive", ei);
				document.dispatchEvent(ws_sniff);
				
				websocketReceive(msg[i]);
			}
		});

		this.addEventListener('open', event => {
			// Send a custom event that the add-on can listen for
			let ei = { detail: { data: event, obj: this } };
			let ws_sniff = new CustomEvent("sniffer_ws_open", ei);
			document.dispatchEvent(ws_sniff);
		});

		
	}
	send(...args) {
		// typeof(data) is "message", typeof(obj) is "websocket"
		// data.data has the actual message.
		// data.origin is something like "wss://v3proxysl9.bridgebase.com"
		// obj.protocol is "binary"
		// obj.binaryType is "array buffer"
		// obj.url is something like "wss://v3proxysl9.bridgebase.com"
					
		// This is a string. It will start with "cs_", e.g. "cs_ping" or 
		// "cs_scan_reservations" because this is the BBO convention for all
		// messages from the client to the server.
		let msg = args[0];
		if (msg.startsWith('cs_make_bid')) {
			args[0] = processAuctionCall(msg);
		}
		else if (msg.startsWith('cs_play_card')) {
			// Track this just to handle undos properly.
			app.deal.ncardsPlayed++;
		}
		else if (msg.startsWith('cs_bid_explanation')) {
			// User is responding to request for an explanation.
			args[0] = processCallExplanation(msg);
		}			
		else if (msg.startsWith('cs_chat')) {
			// Perform suit symbol substitution. Parameter=Value type field are
			// separated by '\x01' for client to server messages. Terminator is
			// always a NULL byte.

			let channel, message, ixChannel, ixTable, ixUsername;
			let fd = msg.substr(0,msg.length-1).split('\x01');
			for (let i=1; i<fd.length; i++) {
				if ( fd[i].startsWith('message=') ) {
					message = fd[i].substr('message='.length);
					try { fd[i] = 'message=' + chatFixer(message, false); }
					catch(e) { console.error('BBO Helper: chatFixer() error', e); }
				}
				else if ( fd[i].startsWith('channel=') ) {
					// 'lobby', 'table', 'specs' (spectators, i.e. kibitzers), 'private',
					// 'tourney'
					ixChannel = i;
					channel = fd[i].substr('channel='.length);
				}
				else if ( fd[i].startsWith('table_id=') ) { ixTable = i; }
				else if ( fd[i].startsWith('username=') ) { ixUsername = i; } 
			}
			
			if ( message.startsWith('/') && channel !== 'table' && app.table &&
					app.table.table_id ) {
				// Table greeting. Set chat channel to "table" even if the UI is set
				// to another channel (e.g. a user), remove any "username" parameter,
				// and add table_id parameter.
				fd[ixChannel] = 'channel=table';
				if (ixUsername !== undefined) { fd.splice(ixUsername,1); }
				if (ixTable === undefined) {
					fd.splice(fd.length-1, 0, 'table_id=' + app.table.table_id);
				}
			}
			
			let newmsg = fd[0];
			for (let i=1; i<fd.length; i++) { newmsg += '\x01' + fd[i]; }
			args[0] = newmsg + '\x00';
		}
		else if (msg.startsWith('cs_vote_request') && pref.appClaimAutoSuits) {
			// Perform suit symbol substitution in claims.
			const param = 'explanation=';
			let fd = msg.substr(0,msg.length-1).split('\x01');
			for (let i=1; i<fd.length; i++) {
				if (fd[i].substr(0,param.length) === param) {
					try { fd[i] = param + chatFixer(fd[i].substr(param.length), true); }
					catch(e) { console.error('BBO Helper: chatFixer() error', e); }
					break;
				}
			}
			let newmsg = fd[0];
			for (let i=1; i<fd.length; i++) { newmsg += '\x01' + fd[i]; }
			args[0] = newmsg + '\x00';
		}
		
		super.send(...args);
		
		if ( !msg.startsWith('cs_ping') && !msg.startsWith('cs_keepalive') ) {
			if (this.consoleLogging) { console.info(msg); }
		}
		
		// Send a custom event that the add-on can listen for
		let ei = { detail: { "time": Date.now(), "msg": args[0] } };
		let ws_sniff = new CustomEvent("sniffer_ws_send", ei)
		document.dispatchEvent(ws_sniff);
	}
}

// Extending XMLHttpRequest() will throw an error if this is not set
XMLHttpRequest.prototype = null;
const bh_ORIGINAL_XMLHttpRequest = XMLHttpRequest;

var XMLHttpRequest = window.XMLHttpRequest = class extends XMLHttpRequest {
	
	constructor(...args) {
		super(...args);
		
		this.bboHelper = {};   // Our extras
		this.consoleLogging = false; // pref.appSnifferConsoleLog;
		
		this.addEventListener('load', () => {
			bh_XHR_counter++;
			
			// Only want responses from https://webutil.bridgebase.com/ and
			// https://webutil.bridgebase.com/ (GIB double dummy engine).
			// Other XHR requests download icons, images, SVG and other things we
			// don't care about. Since responseType is always 'text' from the
			// webutil server, this.response will be text.
			const re = /^https?:\/\/(webutil|gibrest)\.bridgebase\.com\//;
			if ( this.bboHelper.url.search(re) !== - 1 ) {
				this.bboHelper.responseTime = Date.now();
				this.bboHelper.responseType = this.responseType;
				if (this.consoleLogging) {
					let s = this.bboHelper.method === 'POST' ? this.bboHelper.formdata : '';
					console.info(bh_XHR_counter, this.bboHelper.method, this.bboHelper.url, s);
					console.info(this.response);
				}
				this.bboHelper.response = this.response;

				// EventInit object
				let ei = { detail: this.bboHelper };
				let sniffer_xhr_load = new CustomEvent("sniffer_xhr_load", ei);
				document.dispatchEvent(sniffer_xhr_load);
			}
			
		});
	}

	open(...args) {
		// args[0] is the method, e.g. 'GET' or 'POST', arg[1] is the URL.
		this.bboHelper.method = args[0];
		this.bboHelper.url = args[1];
		// console.info('open', this.bboHelper);
		
		super.open(...args);
	}
	
	send(...args) {				
		// Not currently altering or squashing any outgoing requests.
		// The form data for a POST pops up in args[0];
		this.bboHelper.sendTime = Date.now();
		if (this.bboHelper.method === 'POST') {
			this.bboHelper.formdata = args.length ? args[0] : '';
		}

		let ei = { detail: this.bboHelper };
		let sniffer_xhr_send = new CustomEvent("sniffer_xhr_send", ei);
		document.dispatchEvent(sniffer_xhr_send);
		// if (this.consoleLogging) { console.info('send', this.bboHelper); }
		
		super.send(...args);
	}
}

function prefUpdate(e) {
	// Load updated user preferences.
	console.info('BBO Helper: received updated user preferences.');
	pref = e.detail;
}

function explanationSubs(explanation) {
	// Explanation substitutions for <cs_make_bid> and <cs_bid_explanation>
	// messages.
	
	const substitutions = {
		"c1":   "First round control",
		"c2":   "Second round control",
		"c12":  "First or second round control",
		"cc1":  "Cheapest first round control",
		"cc2":  "Cheapest second round control", 
		"cc12": "Cheapest first or second round control",
		"f1":   "Forcing for one round",
		"gf":   "Game forcing",
		"nf":   "Non-forcing",
		"nfc":  "Non-forcing constructive",
		"nat":	"Natural",
		"p/c":  "Pass or correct",
		"pen":  "Penalty",
		"to":	"Takeout",
		"t/o":	"Takeout",
		"hs":   "Help suit",
		"hsgt": "Help suit game try",
		"xf":   "Transfer",			
		"un":   "Undiscussed" };
	
	const sub = substitutions[ explanation.trim().toLowerCase() ];
	if (sub !== undefined) { auctionAlertMessage(sub, 'sub'); }	
	
	return sub;
}

function processAuctionCall(msg) {

	let pos = msg.search('\x01bid=');
	let cc = msg.charCodeAt(pos+5);
	let call = (cc < 49 || cc > 55) ? msg.charAt(pos+5) : msg.substr(pos+5,2);
	
	// BBO uses lowercase p,d,r for Pass, Double, and Redouble in 
	// <sc_call_made> and uppercase in <cs_make_bid>. Normalize to lowercase.
	let lowercall = call.length === 2 ? call : call.toLowerCase();
	app.deal.auction.push(lowercall);
	if (app.deal.auctionOpenIx === -1 && call.length === 2) {
		// Record index of opening bid.
		app.deal.auctionOpenIx = app.deal.auction.length - 1;
	}
	
	let hasExplanation = msg.search('\x01explanation=\x01') === -1;
	if ( hasExplanation || pref.appAutoAlerts ) {
		let bModifiedMessage = hasExplanation;
		let alert;
	
		if (pref.appAutoAlerts && !hasExplanation) {
			// See if there is an automatic alert to add.
			try {
				// Be careful here. Auto Alerting is complex. Don't let an
				// error here cause call not to go out.
				alert = autoAlert();
				if (alert !== undefined && alert.length > 0) {
					console.info('BBO Helper: adding alert:', alert);
					bModifiedMessage = true;
				}
			}
			catch(e) { console.error('BBO Helper: autoAlert() error', e); }
		}
		
		if (bModifiedMessage) {
			// Rebuild the outgoing message.
			let fd = msg.substr(0,msg.length-1).split('\x01');
			for (let i=1; i<fd.length; i++) {
				if (fd[i] === 'alert=n') { fd[i] = 'alert=y'; }
				else if (fd[i].startsWith('explanation=') ) {
					if (!hasExplanation) {
						fd[i] = 'explanation=' + alert.substr(0, MAX_ALERT_MESSAGE_LENGTH);
					}
					else if ( pref.appAlertSubstitutions ) {
						let explanation = fd[i].substr('explanation='.length);
						// Convenient substitutions.
						const sub = explanationSubs(explanation);
						if (sub !== undefined) { explanation = sub;	}
						
						// Add explanation mark before bare suit letters.
						const rg = /(?<![a-zA-Z!])([cdhs])(?![a-zA-Z])/gi;
						explanation = explanation.replace(rg, '!$1');
						
						explanation = explanation.substr(0, MAX_ALERT_MESSAGE_LENGTH);
						fd[i] = 'explanation=' + explanation;
					}
				}
			}
			
			msg = fd.join('\x01') + '\x00';
		}
		
		// Inform user that we automatically added an alert.
		if (bModifiedMessage && !hasExplanation) { auctionAlertMessage(alert, 'auto'); }
	}
	
	return msg;
}

function processCallExplanation(msg) {
	// Handle <cs_bid_explanation> messages where user is asked for an explanation
	// of a call or amends their original explanation.
	
	if ( !pref.appAlertSubstitutions ) { return msg; }

	let fd = msg.substr(0,msg.length-1).split('\x01');
	for (let i=1; i<fd.length; i++) {
		if ( !fd[i].startsWith('explanation=') ) { continue; }
		
		let explanation = fd[i].substr('explanation='.length);
		let sub = explanationSubs(explanation);
		if (sub !== undefined) { explanation = sub;	}
						
		// Add explanation mark before bare suit letters.
		const rg = /(?<![a-zA-Z!])([cdhs])(?![a-zA-Z])/gi;
		explanation = explanation.replace(rg, '!$1');
			
		explanation = explanation.substr(0, MAX_ALERT_MESSAGE_LENGTH);
		fd[i] = 'explanation=' + explanation;
	}
	
	// Rebuild the outgoing message.
	msg = fd.join('\x01') + '\x00';
	
	return msg;
}	

function chatFixer(t, baresuit) {
	// Improves a chat or claim message by automatically inserting ! for suit symbols
	// when message contains items that look like bids, cards, or hands. For claims
	// bare suit letters are substituted as well.
	
	if (t === '/') { t = app.greeting; }
	else if ( t.startsWith('/')) {
		t = t.substr(1);
		app.greeting = t;
	}
	
	if (pref.appChatNameSubs) {
		// "South" conflicts with "Spades" for substitution. Use 't' instead.
		t = t.replace(/(?<![\w])!([twne])(?!\w)/gui, namesub);
	}
	
	function namesub(match, seat) {
		if (seat.charCodeAt(0) < '96') {
			// Return seat name for uppercase, e.g. !N --> North
			return seat === 'T' ? 'South' : seat === 'W' ? 'West' : seat === 'N' ?
					'North' : 'East';
		}
		else {
			let ix = seat === 't' ? 0 : seat === 'w' ? 1 : seat === 'n' ? 2 : 3;
			if (app.table !== undefined && app.table.players[ix] !== '') {
				return app.table.players[ix];
			}
			return seat === 't' ? 'South' : seat === 'w' ? 'West' : seat === 'n' ?
					'North' : 'East';				
		}
	}
	
	if (!pref.appChatAutoSuits) { return t; }
	
	function uppercase(x) { return x.toUpperCase(); }
	
	// First capitalize anything that looks like a notrump bid. This uses
	// the negative lookbehind (?<!) and negative lookahead (?!) search operators.
	// Using [\p{L}\p{N}] (Unicode attributes for letter-like and number-like),
	// instead of \w which is limited to the Latin alphabet. Using this required
	// the u flag. 
	//
	// See https://unicode.org/reports/tr18/#General_Category_Property
	t = t.replace(/(?<![\p{L}\p{N}])[1-7]nt?(?![\p{L}\p{N}])/gui, uppercase);
	
	// Add ! mark to bids. First argument to the anonymous function is the full
	// match which we don't need. The {} destructuring assignment in the first
	// argument avoids a lint warning for an unused argument.
	t = t.replace(/(?<![\p{L}\p{N}])([1-7])([cdhs])(?![\p{L}\p{N}])/gui, '$1!$2');
	
	// Now look for things that appear to be suits (a single card is a special case)
	// Include apostrophe in the negative look behind so that 's' at the end of an
	// a possessive is not converted to a spade symbol (assuming other conditions are
	// met. Cards in a suit must be rank ordered for it to be recognized. Any number
	// of 'x' symbols may follow last card to indicate small cards.
	function suitfix(match, suit, cards) {
		// Don't convert a bare letter to a suit symbol except in claims.
		if (match.length === 1 && !baresuit) { return match; }
		// Don't convert uppercase SA or CA because SA often means "Standard American"
		// and CA often means California. Also leave Hx for Honor-doubleton.
		if (match === 'SA' || match === 'CA' || match === 'Hx') { return match; }
		
		// Don't convert SAT, HAT, DAT (for consistency), or CAT (all common English
		// words), unless exactly sAT, hAT, dAT, cAT
		if (match.search( /^[cdhs]AT$/ ) === -1 &&  match.search( /^[cdhs]at$/i ) === 0) {
			return match;
		}
		
		// Want to cards to be uppercase but any 'x' for small cards as lowercase
		ix = cards.indexOf('x');
		if (ix === -1) { cards = cards.toUpperCase(); }
		else { cards = cards.substr(0,ix).toUpperCase() + cards.substr(ix); }

		return ('!' + suit + cards);
	}

 	// Important again to use [\p{L}\p{N}] instead of \w in the regular expression, for
 	// example so that Danish word for 'East' does not convert 'st' at end of the word;
 	// probably relevant for other languages too. Use RexExp() constructor to break up
 	// this long regular expression. Need \\p{L} etc to escape \p{L} that we want!
 	const suitRE = new RegExp(
		"(?<![\\p{L}\\p{N}'!])" +
		"([cdhs])(A?K?Q?J?(T|10)?9?8?7?6?5?4?3?2?x*)" +
		"(?![\\p{L}\\p{N}])", "giu");

	t = t.replace(suitRE, suitfix);
	
	return t;
}

function websocketReceive(msg) {
	// Track app information that we need on the injection side, e.g. the auction
	// so that we can automatically add alerts for some common auction.
	
	let mtype = msg.substr(1, msg.search(' ')-1);

	if (mtype === 'sc_card_played') {
		// Tracked just to handle undos properly.
		app.deal.ncardsPlayed++;
	}
	else if (mtype === 'sc_call_made' && app.deal !== undefined) {
		// This is probably faster than the DOM parser for this common message.
		// Include leading space as small defense against 'call=' appearing in
		// the explanation for a call.
		let pos = msg.search(' call=');
		let cc = msg.charCodeAt(pos+7);
		let call = (cc < 49 || cc > 55) ? msg.charAt(pos+7) : msg.substr(pos+7,2);
		app.deal.auction.push(call);
		if (app.deal.auctionOpenIx === -1 && call.length === 2) {
			app.deal.auctionOpenIx = app.deal.auction.length - 1;
		}
	}
	else if (mtype === 'sc_deal') {
		const parser = new DOMParser();
		let doc = parser.parseFromString(msg, "application/xml");
		app.deal = stuffAttributes( doc.getElementsByTagName('sc_deal')[0] );
		app.deal.auction = [];
		app.deal.auctionOpenIx = -1;
		app.deal.ncardsPlayed = 0;
		// Hide auction clock until first bid if it is in use.
		let el = document.getElementById('bhAuctionClock');
		if (el !== null) { el.hidden = true; }
	}
	else if (mtype === 'sc_table_node') {
		const parser = new DOMParser();
		let doc = parser.parseFromString(msg, "application/xml");
		app.table = stuffAttributes( doc.getElementsByTagName('sc_table_open')[0] );
		app.table.players = ['', '', '', ''];
	}
	else if (mtype === 'sc_player_sit') {
		const parser = new DOMParser();
		let el = parser.parseFromString(msg, "application/xml").children[0];
		let seat = el.getAttribute('seat');
		let ix = seat === "south" ? 0 : seat === "west" ? 1 : seat === "north" ? 2 : 3;
		app.table.players[ix] = el.getAttribute('username');  // label works too.
	}
	else if (mtype === 'sc_player_stand' && app.table !== undefined) {
		// Need second condition above because when you leave a table, that 
		// generates a <cs_leave_table> message, followed by a <sc_table_close>
		// response from the server. The <sc_player_stand> for you comes after that.
		const parser = new DOMParser();
		let el = parser.parseFromString(msg, "application/xml").children[0];
		let seat = el.getAttribute('seat');
		let ix = seat === "south" ? 0 : seat === "west" ? 1 : seat === "north" ? 2 : 3;
		app.table.players[ix] = '';
	}
	else if (mtype === 'sc_table_close') {
		app.table = undefined;
		app.deal = undefined;
	}
	else if (mtype === 'sc_undo') {
		// Undo handling occurs both in the injected code and in bbov3.js
		// which have independent APP variables, tracking state. The undo is
		// simpler here since we only care about rolling back the auction if
		// necessary (to handle auto alerts properly).	
		let undoCountMatch = msg.match( /(?<= count=")\d+(?=")/ );
		if (undoCountMatch === null) { return; }
		let undoCount = parseInt( undoCountMatch[0] );
		
		const positionMatch = msg.match( /(?<= position=")\W+(?=")/ );
		const position = positionMatch !== null ? positionMatch[0] : undefined;
		
		// Case of count="0" position="*" is confusing. Still looks like one action
		// must be rolled back. Perhaps "*" means next seat has not acted yet.
		if (undoCount === 0 && position === '*') { undoCount = 1; }			

		if (app.deal.ncardsPlayed >= undoCount) {
			app.deal.ncardsPlayed -= undoCount;
		}
		else {
			// Rollback is partly or completely in the auction.
			let nCallsUndone = undoCount - app.deal.ncardsPlayed;
			app.deal.auction.length = app.deal.auction.length - nCallsUndone;
			app.deal.ncardsPlayed = 0;
	
			if (app.deal.auctionOpenIx > app.deal.auction.length - 1) {
				// Rolled back past the opening bid
				app.deal.auctionOpenIx = -1;
			}
		}
	}
	else if (mtype === 'sc_loginok') {
		const parser = new DOMParser();
		let doc = parser.parseFromString(msg, "application/xml");
		let el = doc.getElementsByTagName('sc_loginok')[0];
		app.user = el.getAttribute('user');
		app.usersp = el.getAttribute('sp');
		app.deal = undefined;
	}
}

function stuffAttributes(el) {
	// Stuffs all the attributes of a DOM object into an object. Mostly used
	// for storing components of server to client BBO application XML.
	let ob = {};
	let attr = el.getAttributeNames();
	for (let j=0; j<attr.length; j++) { ob[attr[j]] = el.getAttribute(attr[j]); }
	return ob;
}

function amVul() {
	// Returns whether the user is vulnerable on the deal.
	// Note: This doesn't work right if a player is seated multiple times at
	// a teaching table.
	let v = app.deal.vul;
	if (v === 'o') { return false; }
	if (v === 'b') { return true; }
	let ix;
	for (ix = 0; ix<4; ix++) {
		if ( app.table.players[ix] === app.user ) { break; }
	}
	return ix % 2 ? v === 'e' : v === 'n';
}

function autoAlert(auction, vul) {
	// AUCTION - Array of calls (used for testing)
	// VUL     - Boolean (used for testing)
	
	let au, auctionOpenIx;
	
	if (auction === undefined) {
		// Normal case
		au = app.deal.auction;
		auctionOpenIx = app.deal.auctionOpenIx;
	}
	else {
		// Test mode
		au = auction;
		auctionOpenIx = -1;
		for (let ix=0; ix<au.length; ix++) {
			if (au[ix] !== 'p') { auctionOpenIx = ix; break; }
		}
		// Assume not vulnerable unless otherwise stated.
		if ( vul === undefined ) { vul = false; }
	}
	
	// Supply automatic alerts for certain cases.
	// Note: Pass ('p'), Double ('d'), Redouble ('r') normalized to lowercase upstream.
	const ix2 = au.length-1;
	const call = au[ix2];
	
	// Not handling alerts for forcing pass systems(!)
	if (auctionOpenIx === -1) { return; }
	
	// Not alerting any passes, doubles, or redoubles at this point.
	if (call.length === 1) { return; }
	
	const aa = pref.aa;
	
	const ix1 = auctionOpenIx;
	if (ix1 === au.length-1) {
		// Opening bid
		if (call === '1N') {
			// Special case of different treatment for V vs. NV
			if (vul === undefined) { vul = amVul(); }
			return vul && aa.opening["1NTvul"] ? aa.opening["1NTvul"] : aa.opening[call];
		}
		if (ix1 === 3 && aa.opening.FourthSeat2Bid !== '' && call.charAt(0) === '2' &&
				call !== '2C' && call !== '2N') {
			return aa.opening.FourthSeat2Bid;
		}
		return (aa.opening !== undefined && aa.opening[call] !== undefined) ?
				aa.opening[call] : undefined;
	}
	
	const openingBid = au[ix1];
	if ( (ix2-ix1) === 2 && openingBid === '1N') {
		if (aa.nt === undefined) { return; }
		if ( au[ix1+1] === 'p' ) {
			// Uncontested responses to 1NT
			if (call === '2D' || call === '2H') {
				return aa.nt.JacobyTransfers ? 'Transfer' : undefined;
			}
			if (call === '2S' || call === '2N' || call.charAt(0) === '3') 
				{ return aa.nt[call]; }
			if (call === '4D' || call === '4H') {
				return aa.nt.TexasTransfers ? 'Transfer' : undefined;
			}
		}
		else {
			// Will add Lebensohl and such here.
			return;
		}
	}
	
	if ( (ix2-ix1) === 1 && openingBid === '1N') {
		// Defense to 1NT
		if (aa.ntdef === undefined) { return; }
		return aa.ntdef[call];
	}
	
	if ( (ix2-ix1) === 2 && au[ix1+1] === 'p' ) {
		// Responding w/o interference.

		if (openingBid === '1H' || openingBid === '1S') {
			// Responses to a major suit opening

			if (call === '1N') {
				// Maybe a forcing notrump.
				if (aa.forcingNT === 'forcing') { return 'Forcing'; }
				if (aa.forcingNT === 'semi') { return 'Semi-forcing'; }
				if (aa.forcingNT === 'semi-passed') {
					return ix1 < 2 ? 'Forcing' : 'Semi-forcing';
				}
				return; // non-forcing case (nothing to alert)
			}

			else if ( call === '2N' ) {
				// Jacoby 2NT is only applies to an unpassed hand.
				return aa.Jacoby2NT && ix1 < 2 ? 
					'4+ card supp, GF, no shortness (Jacoby)' : undefined;
			}

			else if ( (openingBid === '1H' && call === '3H') ||
					(openingBid === '1S' && call === '3S') ) {
				return aa.majorJumpRaise;
			}

			else if ( call === '4C' || call == '4D' || 
					(openingBid === '1H' && call === '3S') ||
					(openingBid === '1S' && call === '4H') ) {
				return aa.majorSplinters ? 
					'0 or 1 !' + call.substr(-1).toLowerCase() +
					' with 4+ card supp (splinter)' : undefined;
			}
			
			return;
		}
	
		if ( (openingBid === '1C' && call === '2C') ||
			 (openingBid === '1D' && call === '2D') ) {
			return aa.invertedMinors ? 'Inverted' : undefined;
		}
		
		if ( (openingBid === '1C' && call === '3C') ||
			  (openingBid === '1D' && call === '3D') ) {
				return aa.minorJumpRaise;
		}
		
		if (openingBid === '1C' && (call === '2D' || call === '2H' || call === '2S') ) {
			return aa.OneTwoJumpResponse;
		}
		if (openingBid === '1D' && (call === '2H' || call === '2S') ) {
			return aa.OneTwoJumpResponse;
		}
		if (openingBid === '1H' && call === '2S' ) {
			return aa.OneTwoJumpResponse;
		}
		
		if ( (openingBid === '2D' || openingBid === '2H' || openingBid === '2S') && ix1<3) {
			// Response to Weak Two openings. Fourth seat bids are excluded
			// because those are not weak (or at least shouldn't be).
			if (call === '2N') {
				return aa.weak2NT === 'feature' ? 'Asking for an outside A or K' :
					aa.weak2NT === 'OGUST' ? 'OGUST (strength and trump quality ask)' :
					undefined;
			}
		}
		
		return;
	}
	
	if ( (ix2-ix1) === 1 ) {
		// Type of overcalls
		if ( call === '1N' ) { return aa.NTovercall; }
		
		if ( au[ix1].charAt(1) === au[ix2].charAt(1) && call.charAt(0) === "2" ) {
			// Direct cue bid (Michaels or Top and Bottom)
			let explain;
			const dcb = aa.directCueBid;
			if ( dcb === undefined || dcb.type === undefined ) { return; }
			let denom = au[ix2].charAt(1);
			if ( dcb.type === 'Michaels' ) {
				explain = (denom === 'C' || denom === 'D') ? '!h + !s' :
					( denom === 'H') ? '!s + minor' : '!h + minor';
			}
			else if ( dcb.type === 'Top and Bottom') {
				explain = (denom === 'C') ? '!s + !d' : (denom === 'S') ? '!h + !d' :
					'!s + !c';
			}
			else { return; }
			
			let style = twoSuitedStyle(dcb.style, vul);
			if (style !== undefined) { explain += ', ' + style; }
			return explain;
		}
		
		if ( au[ix1].charAt(0) === '1' && call === '2N' ) {
			// Unusual Notrump ("Minors" or "Two Lowest")
			let explain;
			let unu = aa.jump2NT;
			if ( unu === undefined || unu.type === undefined ) { return; }
			if ( unu.type === 'Minors') { explain = '!c + !d'; }
			else if ( unu.type === 'Two Lowest' ) {
				let denom = au[ix1].charAt(1);
				explain = denom === 'C' ? '!d + !h' : denom === 'D' ? '!c + !h' :
					'!c + !d';
			}
			else { return; }
			
			let style = twoSuitedStyle(unu.style, vul);
			if (style !== undefined) { explain += ', ' + style; }
			return explain;
		}
		
		return;
	}
	
	if ( (ix2-ix1) === 3 && au[ix1+1] === 'p' && au[ix1+2] === 'p' ) {
		// Balancing bids
		if ( call === '1N' ) { return aa.NTbalancing; }
	}

}

function twoSuitedStyle(style, vul) {
	// Returns style for two suited calls like Michaels and Unusual Notrump
	if (style === undefined) { return; }
	
	if (style === '5-5') { return '5-5 or better'; }
	else if (style === '5-4') { return '5-4 or better'; }
	else if (style === '5-4-not22') { return '5-4 or better (5-4-2-2 rare)'; }
	
	// Otherwise varies depending on vulnerability
	if (vul === undefined) { vul = amVul(); }
	if (style === '5-4-NV') { return vul ? '5-5 or better' : '5-4 or better'; }
	if (style === '5-4-NV-not5422') {
		return vul ? '5-5 or better' : '5-4 or better (5-4-2-2 rare)';
	}
}

async function auctionAlertMessage(msg, mode) {
	// Display a brief msg centered in the <div> that displays the auction
	// in the main playing area.
	//
	// Mode - 'auto' (for auto alert) or 'sub' (substitution)
	
	let ds = document.getElementsByClassName('dealScreenDivClass');
	if (ds.length === 0) { return; }  // guarding against BBO UI changes
	
	let abb = ds[0].getElementsByClassName('auctionBoxClass');
	if (abb.length == 0) { return; }
	
	let ab = abb[0];
	
	// Escape HTML and substitute in suit symbols.
	msg = msg.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
	msg = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')
	msg = msg.replace(/!s/gi, '&spades;').replace(/!c/gi, '&clubs;');
	msg = msg.replace(/!d/gi, '<span style="color: red">&diams;</span>');
	msg = msg.replace(/!h/gi, '<span style="color: red">&hearts;</span>');

	let dv = document.createElement('div');
	dv.innerHTML = (mode === 'auto' ? 'Auto alert: ' : 'Sent as: ')  + msg;
	
	dv.style = 'position: absolute; padding: 0.2em 0.5em 0.2em 0.5em; ' + 
		'background: white; color: blue; width: 10em; ' + 
		'font-size: 150%; font-family: sans-serif';
	
	ab.appendChild(dv);
	
	// Display auto-alert msg centered in the auction box.
	let left_px = (ab.offsetWidth - dv.offsetWidth) / 2;
	let top_px = (ab.offsetHeight - dv.offsetHeight) / 2;
	dv.style.left = left_px + 'px';
    dv.style.top  = top_px + 'px';
	
	setTimeout(() => { dv.remove(); }, 1500);
}

console.info('BBO Helper: Code injection succeeded for Websocket and XHR sniffing ' + 
	'(monitors BBO client-server traffic) and related code.');
