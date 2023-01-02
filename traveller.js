/* Make improvements to traveller shown on BBO "My Hands" 
 * 
 *  - Change title from "Bridge Base Online - Myhands" to "Board # (Event)", e.g
 *    "Board 5 Traveller (ACBL Open-Pairs Thu 1:10 PM)". Also add similar <h1>
 *    element
 *  - Add opening lead column to Traveller table
 *  - Change "EW Points" or "NW Points" to "EW" or "NS" for compactness
 *  - Add auction sorted table
 *  - Add contract frequency table
 *  - Add auction frequency table
 *  - Add principal auction variants table
 *  
 *  BBO Helper browser add-on (Matthew Kidd, San Diego) 
*/

"use strict";

// VAR not LET because APP is referenced in common.js. This primarily used in the 
// for the BBO application (bbov3.js) and standalone BBO Handviewer (handviewer.js)
// but we include it here too to prevent issue when app.prefLoaded is set.
var app = {};

// Useful for quick HTML escaping. Faster than doing string replacement on <, >, &, ", etc
app.textarea = document.createElement('textarea');
app.textarea.id = 'bh-HTMLescape';
app.textarea.hidden = true;

// Prevent issue caused by reloading the add-on during development when
// columns have already been added to the table.
let tables = document.getElementsByTagName('table');
let ncols = tables ? tables[0].getElementsByTagName('tr')[1].children.length : 0;

if (ncols > 11) { 
	console.info('Page was already altered by add-on. Reload page to refresh.');
}
else {
	fixpage();
}

async function fixpage() {
	
	let stime = Date.now();
	improveTitle();
	
	// Wait for PREF to load.
	let sleepTime = 10;
	let maxTries = 10;
	for (let itry=1; itry<=maxTries; itry++) {
		if (app.prefLoaded) { break; }
		await sleep(sleepTime);
		if (itry === maxTries) {
			console.warn('Failed to load PREF after %d mS. Using defaults.', 
				maxTries * sleepTime);
		}
	}
	
	let rs = updateTable();

	let [contractArray, auctionArray] = contractsAndAuctions(rs);
	let auTree = auctionTree(rs);
	
	contractTable(contractArray);
	auctionTable(auctionArray);
	
	mainAuctionsTable(auTree);
	
	console.info("BBO Helper: Traveller.js completed in %d mS", Date.now() - stime);
	
	document.addEventListener('keydown', (event) => {
	
		// Only trap Alt key combinations (without other modifiers)
		if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey ) { return; }
	
		// It's important to use event.code here. Mac OS uses the Option/Alt key 
		// combinations to generate special symbols and event.key will reflect that symbol.
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
	
}

function improveTitle() {

	let et = document.getElementsByClassName('tourneyName');
	let er = document.getElementsByClassName('tourney');

	if (et.length == 0 || er.length == 0) { return; }

	// Improve the title of the webpage.
	let tourneyName = et[0].innerText;
	
	// Field is YYYY-MM-DD HH:MM
	let tds = er[0].getElementsByTagName("td");
	let datestr = tds[1].innerText.substr(0,10);
	
	// Extract the hv_popuplin('...') onclick text.
	let hvp = tds[9].getElementsByTagName('a')[0].getAttribute('onclick');
	let epos = hvp.indexOf("');");
	let lin = hvp.substring(13, epos);
	
	// Need decodeURIComponent() to remove pipe symbols converted to %7F, exclamation
	// mark for alerts converted to %21, spaces converted to %20, etc.
	lin = decodeURIComponent(lin);
	
	console.info('BBO Helper: lin:', lin);
	
	let r = linparse(lin);
	
	let tourneyNameShort = tourneyName;
	tourneyNameShort = tourneyName.substring(tourneyName.indexOf(' ')+1, 
			tourneyName.indexOf('(')-1);
	// Add space before final AM or PM designator.
	tourneyNameShort = tourneyNameShort.replace( /(\S)([AP]M)$/, '$1 $2' );
	
	let tstr = 'Board ' + r.bnum + ' - ' + datestr + ' ' + tourneyNameShort;
	
	document.title = tstr;
	
	let el = document.createElement('h1');
	el.innerText = tstr;
	
	let originalTable = document.getElementsByTagName('table')[0];
	originalTable.insertAdjacentElement('beforebegin', el);
}

function updateTable() {

	let rows = document.getElementsByTagName('table')[0].getElementsByTagName('tr');

	// Rename 'EW Score' / 'NS Score' column to just 'EW' or 'NS' to save space.	
	let hrow = rows[1];
	let thScore = hrow.children[7];
	thScore.innerHTML = thScore.innerHTML.substr(0,2);

	// If these are tournament hands, the tournament information will appear
	// on the third row of the table.
	let sessionScore, srow;
	if ( rows[2].getAttribute('class') === 'tourneySummary' ) {
		srow = rows[2];
		sessionScore = rows[2].children[3].innerHTML;
	}
	
	let row = sessionScore === undefined ? rows[2] : rows[3];
	let isMP = row.children[8].innerText.endsWith('%');
	if ( isMP ) {
		// Make score column a bit wider if contains matchpoint percentages.
		hrow.children[8].classList.add('tourneyScoreWider');
	}
	
	// Number of columns spanned by the name of the event
	const eventnamecolspan = 5;

	// Add lead and auction columns to header.
	let thLead = document.createElement('th');
	thLead.innerText = 'Ld';
	thLead.classList.add('leadcol');
	hrow.children[6].insertAdjacentElement('afterend', thLead);

	let thAuction = document.createElement('th');
	thAuction.innerHTML = 'Auction';
	thAuction.classList.add('auctioncol');
	hrow.children[10].insertAdjacentElement('afterend', thAuction);

	// Add empty <td> elements to the session score row if it is present.
	if ( srow !== undefined ) {
		let sLead = document.createElement('td');
		srow.children[6-eventnamecolspan].insertAdjacentElement('afterend', sLead);
	
		let sAuction = document.createElement('td');
		srow.children[10-eventnamecolspan].insertAdjacentElement('afterend', sAuction);
	}

	let rs = [];
	let firstResult = srow === undefined ? 2 : 3;
	for (let i=firstResult; i<rows.length; i++) {
		
		let el = rows[i].children;
		
		// Extract the hv_popuplin('...') onclick text.
		let hvp = el[9].getElementsByTagName('a')[0].getAttribute('onclick');
		let epos = hvp.indexOf("');");
		
		// Extract the LIN string and undo the escaping, i.e. %7C escape for |
		// symbols, etc.
		let lin = decodeURIComponent( hvp.substring(13, epos) );

		let r = linparse(lin);
		
		let tdLead = document.createElement('td');
		tdLead.innerHTML = r.leadhtml;
		el[6].insertAdjacentElement('afterend', tdLead);
		
		let tdAuction = document.createElement('td');

		tdAuction.innerHTML = r.auctionhtml;
		tdAuction.classList.add('ac');
		el[10].insertAdjacentElement('afterend', tdAuction);
		
		let score = el[9].innerHTML;
		// parseFloat() conversion here is important for subsequent sorting.
		r.score = parseFloat(isMP ? score.substr(0, score.length-1) : score);
		r.result = el[6].innerText;
		r.ix = i;
		
		rs.push(r);
	}

	// Fix column span of top header row.
	rows[0].children[0].colSpan += 2;
	
	// Sort by auction with a secondary sort on score.
	rs.sort(auctionSort);
	
	// Create a second table sort by auction.
	let table1 = document.getElementsByTagName('table')[0];
	let table2 = document.createElement('table');
	table2.id = 'auctionSorted';
	table2.classList.add('body');
	let tbody2 = document.createElement('tbody');
	table2.appendChild(tbody2);

	for (let i=0; i<firstResult; i++) {
		// True here means copy children of node being cloned as well.
		tbody2.appendChild(rows[i].cloneNode(true));
	}
	
	let elTitle = table2.children[0].children[0].children[0];
	let msgAuctionSorted = browser.i18n.getMessage('traveller_auction_sorted');
	elTitle.innerHTML = elTitle.innerHTML + ` (${msgAuctionSorted})`;

	for (let i=0; i<rs.length; i++) {
		tbody2.appendChild( rows[rs[i].ix].cloneNode(true) );
	}

	table1.insertAdjacentElement('afterend', table2);
	
	return rs;
}

function auctionSort(a, b) {
	// Sort by auction, then by score (descending), then by result
		
	return (a.auctionsort < b.auctionsort) ? -1 : (a.auctionsort > b.auctionsort) ? 1 :
		(a.score !== b.score) ? (b.score - a.score) : (a.result > b.result) ? -1 :
		(a.result < b.result) ? 1 : 0;
}

function contractTable(contractArray) {
	// Create summary table of contracts.
	
	let table = document.createElement('table');
	table.id = 'contracts';
	
	const colClass = ['col-contract', 'col-cnt', 'col-pct', 'col-details']; 
	for (let i=0; i<colClass.length; i++) {
		let col = document.createElement('col');
		col.className = colClass[i];
		table.append(col);
	}
	
	table.classList.add('body');
	let tbody = document.createElement('tbody');
	table.appendChild(tbody);
	
	// Compute the Shannon entropy. See https://lajollabridge.com/Articles/FieldProtection.htm
	let nresults = 0;
	let entropy = 0;
	for (let i=0; i<contractArray.length; i++) {
		let freq = contractArray[i].cnt
		nresults += freq;
		entropy += freq * Math.log(freq);
	}
	// Final answer is in bits.
	entropy = (Math.log(nresults) - entropy / nresults) / Math.LN2;
	
	let tt = document.createElement('tr');
	const shannonURL = 'https://lajollabridge.com/Articles/FieldProtection.htm';
	
	let tthtml = browser.i18n.getMessage('traveller_contract_freq') + 
		'<span class="shannon">Shannon entropy: ' + entropy.toFixed(2) +
		` bits (<a class="shannonURL" href="${shannonURL}">explanation</a>)</span>`;
	tt.innerHTML = '<th colspan="4">' + tthtml + '<th>';
	tbody.append(tt);
	
	let th = document.createElement('tr');
	th.innerHTML = '<th>Cont</th> <th class="cnt-header">Cnt</th> ' + 
		'<th class="pct-header">Pct</th> <th class="details-header">Details</th>';
	tbody.append(th);
	
	// List each contract.
	for (let i=0; i<contractArray.length; i++) {
		let ca = contractArray[i];
		
		if (ca.contract === 'Pass') {
			// Not much to say about passed out hands.
			let pct = 100 * ca.cnt / nresults;
			let pctstr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
			
			let tr = document.createElement('tr');
			tr.innerHTML = '<td>Pass</td>' + '<td>' + ca.cnt + '</td>' +
				'<td>' + pctstr + '</td>' +  '<td></td>';
			tbody.append(tr);
			continue;
		}
		
		let level = ca.contract.charAt(0);
		let denom = ca.contract.charAt(1);
		let direction = ca.contract.substr(2);
		
		let denomHTML = denom === 'N' ? 'N' : suithtml(denom);
		
		let bothsides = ca.NE > 0 && ca.SW > 0; 
		let seats = bothsides ? direction :
			ca.NE > 0 ? direction.charAt(0) : direction.charAt(1);
		
		let html = '<td>' + level + denomHTML + '-' + seats + '</td>';
		html += '<td>' + ca.cnt + '</td>';
		let pct = 100 * ca.cnt / nresults;
		let pctstr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
		html += '<td>' + pctstr + '</td>';
		
		// Breakdown by direction
		let details = '';
		if (bothsides) { 
			details += seats.charAt(0) + parenNum(ca.NE) + ' ' + 
				seats.charAt(1) + parenNum(ca.SW);
		}
		// Note any doubled or redoubled contracts.
		if (ca.X) { details += ' X' + parenNum(ca.X); }
		if (ca.XX) { details += ' XX' + parenNum(ca.XX); }
		
		// Breakdown by overtricks and undertricks
		let ouvals = [];
		Object.keys(ca.ou).forEach( function(key) { ouvals.push( parseInt(key) ); } );
		ouvals.sort( (a, b) => {return b-a;} );
		
		for (let j=0; j<ouvals.length; j++) {
			if (details.length) { details += ' '; }
			let ou = ouvals[j];
			let oustr = ou > 0 ? '+' + ou : ou < 0 ? ou : '=';
			details += ' <span class=' + (ou >= 0 ? 'ps' : 'ns') + '>' + oustr + '</span>';
			details += parenNum( ca.ou[ou] );
		}
		
		// Cards led, separated by the different leaders.
		if (ca.NE > 0) {
			let leads = [];
			Object.keys(ca.NElead).forEach( function(lead) { leads.push(lead); } );
			leads.sort( (a, b) => { return ca.NElead[b] - ca.NElead[a]; } );
			if (bothsides) {
				let seatstr = seats.charAt(0) + ':';
				details += ' ' + '<span class="leadgroup">' + seatstr + '</span>';
			}
			for (let j=0; j<leads.length; j++) {
				let card = leads[j];
				let suit = card.charAt(0);
				
				// Prevent a widowed 'W:' or similar on a wrapping line.
				details += (j === 0 && bothsides) ? '&nbsp;' : ' ';
				details += suithtml(suit) + card.charAt(1);
				details += parenNum( ca.NElead[card] ); 
			}
		}
		
		if (ca.SW > 0) {
			let leads = [];
			Object.keys(ca.SWlead).forEach( function(lead) { leads.push(lead); } );
			leads.sort( (a, b) => { return ca.SWlead[b] - ca.SWlead[a]; } );
			if (bothsides) {
				let seatstr = seats.charAt(1) + ':';
				details += ' ' + '<span class="leadgroup">' + seatstr + '</span>';
			}
			for (let j=0; j<leads.length; j++) {
				let card = leads[j];
				let suit = card.charAt(0);
				
				details += (j === 0 && bothsides) ? '&nbsp;' : ' ';
				details += suithtml(suit) + card.charAt(1);
				details += parenNum( ca.SWlead[card] );
			}
		}
		
		html += '<td>' + details + '</td>';
		
		let tr = document.createElement('tr');
		tr.innerHTML = html;
		tbody.append(tr);
	}
	
	// Finally add the table to document.
	let originalTable = document.getElementsByTagName('table')[0];
	originalTable.insertAdjacentElement('beforebegin', table);
}

function parenNum(n) {
	// Returns a string with an integer inside parentheses, i.e. 5 --> '(5)'
	if (n === 1) { return ''; }

	return '<span class="cnt">(' + n + ')</span>';
}

function auctionTable(auctionArray) {
	// Create summary table of auctions.
	
	let table = document.createElement('table');
	table.id = 'auctions';
	
	const colClass = ['col-auction', 'col-cnt', 'col-details']; 
	for (let i=0; i<colClass.length; i++) {
		let col = document.createElement('col');
		col.className = colClass[i];
		table.append(col);
	}
	
	table.classList.add('body');
	let tbody = document.createElement('tbody');
	table.appendChild(tbody);
	
	// Compute the Shannon entropy. See https://lajollabridge.com/Articles/FieldProtection.htm
	let nresults = 0;
	let entropy = 0;
	for (let i=0; i<auctionArray.length; i++) {
		let freq = auctionArray[i].cnt
		nresults += freq;
		entropy += freq * Math.log(freq);
	}
	// Final answer is in bits.
	entropy = (Math.log(nresults) - entropy / nresults) / Math.LN2;
	
	let tt = document.createElement('tr');
	const shannonURL = 'https://lajollabridge.com/Articles/FieldProtection.htm';
	
	let tthtml = browser.i18n.getMessage('traveller_auction_freq') + 
		'<span class="shannon">Shannon entropy: ' + entropy.toFixed(2) +
		` bits (<a class="shannonURL" href="${shannonURL}">explanation</a>)</span>`;
	tt.innerHTML = '<th colspan="3">' + tthtml + '<th>';
	tbody.append(tt);
	
	let th = document.createElement('tr');
	th.innerHTML =  '<th class="auction-header">Auction</th>' + 
		'<th class="cnt-header"">Cnt</th> ' + '<th class="details-header">Details</th>';
	tbody.append(th);
	
	// List each contract.
	for (let i=0; i<auctionArray.length; i++) {
		let aa = auctionArray[i];
				
		let html = '<td>' + aa.auctionHTML + '</td>' + '<td>' + aa.cnt + '</td>';
		
		let details = '';
		// Breakdown by overtricks and undertricks
		let ouvals = [];
		Object.keys(aa.ou).forEach( function(key) { ouvals.push( parseInt(key) ); } );
		ouvals.sort( (a, b) => {return b-a;} );
		
		for (let j=0; j<ouvals.length; j++) {
			let ou = ouvals[j];
			let oustr = ou > 0 ? '+' + ou : ou < 0 ? ou : '=';
			details += ' <span class=' + (ou >= 0 ? 'ps' : 'ns') + '>' + oustr + '</span>';
			details += parenNum( aa.ou[ou] );
		}
		
		// Cards led, separated by the different leaders.
		let leads = [];
		Object.keys(aa.lead).forEach( function(lead) { leads.push(lead); } );
		leads.sort( (a, b) => { return aa.lead[b] - aa.lead[a]; } );

		for (let j=0; j<leads.length; j++) {
			let card = leads[j];
			let suit = card.charAt(0);
			
			details += ' ' + suithtml(suit) + card.charAt(1);
			details += parenNum( aa.lead[card] ); 
		}
		
		html += '<td class="details">' + details + '</td>';
		
		let tr = document.createElement('tr');
		tr.innerHTML = html;
		tbody.append(tr);
	}
	
	// Finally add the table to document.
	let originalTable = document.getElementsByTagName('table')[1];
	originalTable.insertAdjacentElement('beforebegin', table);
}

function contractsAndAuctions(rs) {
	// Tally up frequencies and related statistics for contracts and auctions.
	let contracts = {};
	let auctions = {};
	
	for (let i=0; i<rs.length; i++) {
		let result = rs[i].result;
		let bs = rs[i].auctionsort;
		
		if (result.charAt(0) === 'A') {
			// Ignore assigned averages (A==), Ave+ (A+=), and Ave- (A-=)
			continue;
		}
		if (result === 'PASS') {
			if ( !contracts[result] ) { 
				contracts[result] = { "contract": 'Pass', "cnt": 1 };
				auctions[bs] = { "auctionSort": bs, "auctionHTML": rs[i].auctionhtml, 
					"cnt": 1, 'ou': {}, 'lead': {} };
			}
			else {
				contracts[result].cnt++;
				auctions[bs].cnt++;
			}
		}
		else {
			let symbol = result.charAt(1);
			let denom =  (symbol === 'N') ? 'N' : (symbol === '♠') ? 'S' : 
				(symbol === '♥') ? 'H' : (symbol === '♦') ? 'D' : 'C';		
	
			let contract = result.charAt(0) + denom;
			let doubled = result.substr(2,2) === 'xx' ? 2 : 
				result.charAt(2) === 'x' ? 1 : 0;
			let declarer = result.charAt(2+doubled);
			let ou = result.endsWith('=') ? 0 : result.charAt(3+doubled) === '+' ? 
				result.substr(4+doubled) : result.substr(-2);
			
			let pair = declarer === 'N' || declarer === 'S' ? 'NS' : 'EW';
			let cd = contract + pair;
			if ( !contracts[cd] ) {
				contracts[cd] = { 'contract': cd, 'cnt': 1, 'NE': 0, 'SW': 0, 
					'X': 0, 'XX': 0, 'ou': {}, 'NElead': {}, 'SWlead': {} };
			}
			else {
				contracts[cd].cnt++;
			}
			if ( !auctions[bs] ) {
				auctions[bs] = { 'auctionSort': bs, 'auctionHTML': rs[i].auctionhtml,
					'cnt': 1, 'ou': {}, 'lead': {} };
			}
			else {
				auctions[bs].cnt++;
			}			
			
			// Track frequency of leads.
			let lead = rs[i].lead;
			
			// Occasionally there is no opening lead but the auction was completed and
			// the outcome is clear enough that the director(s) can assign a likely result.
			if (lead === undefined) { continue; }

			if ( declarer === 'N' || declarer === 'E' ) {
				contracts[cd]['NE']++;
				if ( !contracts[cd]['NElead'][lead] ) { contracts[cd]['NElead'][lead] = 1; }
				else { contracts[cd]['NElead'][lead]++; }
			}
			else {
				contracts[cd]['SW']++;
				if ( !contracts[cd]['SWlead'][lead] ) { contracts[cd]['SWlead'][lead] = 1; }
				else { contracts[cd]['SWlead'][lead]++; }
			}
			
			if ( !auctions[bs]['lead'][lead] ) { auctions[bs]['lead'][lead] = 1; }
			else { auctions[bs]['lead'][lead]++ }
			
			// Track doubled and redoubled frequencies.
			if (doubled === 1) { contracts[cd]['X']++; }
			else if (doubled === 2) { contracts[cd]['XX']++; }
			
			// Track frequency of over and undertricks.
			if ( !contracts[cd]['ou'][ou] ) { contracts[cd]['ou'][ou] = 1; }
			else { contracts[cd]['ou'][ou]++ }

			if ( !auctions[bs]['ou'][ou] ) { auctions[bs]['ou'][ou] = 1; }
			else { auctions[bs]['ou'][ou]++ }
		}
		
	}
	
	let contractArray = [];
	Object.keys(contracts).forEach( 
		function(key) { contractArray.push( contracts[key] ); } );
	
	contractArray.sort(contractSort);
	
	let auctionArray = [];
	Object.keys(auctions).forEach( 
		function(key) { auctionArray.push( auctions[key] ); } );
	
	// Chrome adheres to the ECMA standard (really the old C sort function) of
	// needs numeric evaluation. Firefox was okay with a true/false evaluation
	// like (a.auctionSort < b.auctionSort)
	auctionArray.sort( (a, b) => { 
		(a.auctionSort < b.auctionSort) ? -1 : (a.auctionSort > b.auctionSort) ? 1 : 0} )
	
	return [contractArray, auctionArray];
}

function contractSort(a, b) {
	// Sort by frequency (descending), then by contract (descending).
	return (a.cnt !== b.cnt ? b.cnt - a.cnt : (a.contract > b.contract) ? -1 :
		(a.contract < b.contract) ? 1 : 0 );
}

function mainAuctionsTable(auTree) {
	// Outer wrapper for nested table generation.
	
	let colElements = [];

	let table = mainAuctionsRecurse(auTree, 0);
	
	table.id = 'principalvariants';
	let thead = document.createElement('thead');
	thead.innerHTML = '<tr class="title"><th colspan="2">' + 
		browser.i18n.getMessage('traveller_pav') + '</th></tr>';
	table.append(thead);
	
	// Attach top level table to main document.
	let firstTable = document.getElementsByTagName('table')[0];
	firstTable.insertAdjacentElement('afterend', table);
	
	// Fiddle with the font size to make things fit well. Need to do this first
	// before the alignment in the next step because browser will ignore the
	// width if necessary to cram enough <td> elements on a row.
	let ncols = colElements.length;
	let fontSize = ncols <= 8 ? 125 : ncols <= 12 ? 110 : ncols <= 15 ? 100 : 
		ncols <= 18 ? 90 : 80;
	table.style.fontSize = fontSize + '%';
	
	// Line up calls on each round of the bidding. Doesn't happen naturally due
	// to the nested tables.
	for (let i=0; i<ncols; i++) {
		let maxWidth = 0;
		let els = colElements[i];
		for (let j=0; j<els.length; j++) {
			if (els[j].offsetWidth > maxWidth) { maxWidth = els[j].offsetWidth; }
		}
		maxWidth = Math.ceil(maxWidth);
		for (let j=0; j<els.length; j++) { 
			els[j].style.width = maxWidth + 'px';
		}
	}
	
	return table;


	function mainAuctionsRecurse(auTree, level) {
		// Recursively create a nested table listing the main auctions, complete 
		// with a frequency count and percentage at each branching point.
		
		let table = document.createElement('table');
		table.className = 'variants';
		
		let cnt = auTree.cnt;
		
		// Sort calls in descending order of occurrence, breaking ties with the
		// order All Pass, P, (X or XX), followed by standard level-denom order.
		let calls = [];
		let children = auTree.children;
		Object.keys(children).forEach( function(call) { calls.push(call); } );
		calls.sort( (a, b) => {
			return children[a].cnt !== children[b].cnt ? children[b].cnt - children[a].cnt : 
				(children[a].callsort < children[b].callsort) ? -1 :
				(children[a].callsort > children[b].callsort) ? 1 : 0} 
		);
		
		let tbody = document.createElement('tbody');
		
		let anybranches = false;
		let totalChildren = 0;
		for (let i=0; i<calls.length; i++) {
			// The percentage of results required to create a principal subtable
			// depends on the number of results.
			let call = calls[i];
			totalChildren += children[call].cnt;
			let pct = 100 *  children[call].cnt / cnt;
			let newbranch = cnt > 200 && pct > 4 || cnt > 100 && pct > 8 || 
				cnt > 20 && pct > 16 || cnt > 10 && pct > 30 || cnt > 4 && pct > 50 ||
				children[call].cnt === cnt;
				
			if (newbranch) {
				anybranches = true;
				
				let tr = document.createElement('tr');
				tbody.append(tr);
				
				let td1 = document.createElement('td');
				td1.className = 'tdcall';
				
				let dv = document.createElement('div');
				dv.className = call === 'AP' ? 'ap' : 'call';
				dv.innerHTML = callhtml(call, children[call].cnt, pct);
				
				// Right way to create a custom element on a DOM object. The explanations
				// <div> code sometimes needs the call to provide the correct hint. Pulling
				// it from this field is cleaner than parsing the the HTML presentations.
				dv.dataset.call = call;
				
				if (children[call].explanations !== undefined) {
					// Note: Custom properties added to DOM elements seem to be visible only
					// in the context of the add-on. So the EXPLANATIONS property will show 
					// up in the event listener but not in the console (unless debugging the code).
					dv.explanations = children[call].explanations;
					dv.addEventListener('click', showExplanations, true);
					
					// Add a green triangle to the lower right corner to indicate explanations exist.
					let img = document.createElement('img');
					img.src = browser.runtime.getURL("images/green-triangle.png");
					img.className = 'exp-indicator';
					
					dv.appendChild(img);					
				}
				
				td1.appendChild(dv);
				
				let td2 = document.createElement('td');
				td2.appendChild( mainAuctionsRecurse( children[call], level+1 ) );
				
				tr.append(td1);
				tr.append(td2);
				
				if ( colElements[level] === undefined ) { colElements[level] = []; }
				colElements[level].push(td1);
			}
		}
		
		if (!anybranches) {
			let tr = document.createElement('tr');
			tbody.append(tr);
			
			let td = document.createElement('td');
			td.setAttribute("colspan", 2);
			
			if ( totalChildren > 10 ) {
				td.innerHTML = 'Many diverse' + '<br>' + 'continuations';
			}
			else if ( totalChildren > 0 ) {
				// Dump all the continuations as a flat list if there are not too many of them.
				let continuations = flattened(auTree.children, 0, '');
				const sepHTML = ' <span class="or">or</span> ';
				if ( continuations.endsWith(sepHTML) ) {
					let len = continuations.length - sepHTML.length;
					continuations = continuations.substr(0, len);
				}
				let html = 'then ';
				html += continuations;
				
				td.innerHTML += html;
				td.className = 'continuations';
			}
	
			tr.append(td);
		}
		
		table.append(tbody);
		
		return table;
	}
	
	function callhtml(call, cnt, pct) {
		// Handle All Pass (AP) pseudo-call as well. 
		let html = call === 'P' ? 'P' : call === 'AP' ? 'AP' :
			call === 'D' ? 'X' : call === 'R' ? 'XX' :
			call.charAt(1) === 'N' ? call : call.charAt(0) + suithtml(call.charAt(1));
			
		html += ' (' + cnt + ')' + '<br>' + pct.toFixed(0) + '%';
		return html;
	}
	
	function flattened(auTree, level, auctionHTML) {
		let html = '';
		let calls = [];
		Object.keys(auTree).forEach( function(call) { calls.push(call); } );
		calls.sort( (a, b) => { return (a.callsort < b.callsort) ? -1 : 
			(a.callsort > b.callsort) ? 1 : 0 } );
		for (let i=0; i<calls.length; i++) {
			let call = calls[i];
			
			if (call === 'AP') {
				// Leaf node. Indicate number of times auction sequence occurred if
				// more than once.				
				html += level === 0 ? 'All Pass' : auctionHTML;
				if (auTree[call].cnt > 1) { 
					html += '&nbsp;<span class="cnt">(' + auTree[call].cnt + 'x)</span>';
				}
				html += ' <span class="or">or</span> ';
				continue;
			}
			
			let callhtml = call === 'P' ? 'P' : call === 'D' ? 'X' : call === 'R' ? 'XX' :
				call.charAt(1) === 'N' ? call : call.charAt(0) + suithtml(call.charAt(1));
			let auctionHTML2 = auctionHTML + '&nbsp;' + callhtml;
			
			let children = auTree[call].children;
			html += flattened(children, level+1, auctionHTML2);
		}
		return html;
	}

}

function auctionTree(rs) {
	// Builds a tree of auctions, tracking frequency of each call.
	// Include pseudo-call of 'AP' (All Pass) at end of auction.
	auctionTree = {'cnt': 0, 'children': {} };
	
	for (let i=0; i<rs.length; i++) {
		let calls = rs[i].calls;
		let ncalls = calls.length;
		
		// Ignore results with no auction. Usually from assigned averages.
		if ( calls.length === 0) { continue; }
		
		// Ignore incomplete auctions.
		if ( calls.length < 4 ) { continue; }
		if ( calls[ncalls-3] !== 'P' && calls[ncalls-2] !== 'P' && 
			calls[ncalls-1] !== 'P' ) { continue; }
		
		auctionTree.cnt++;
		
		// Check for passed out hands.
		if ( calls.length === 4 && calls[0] === 'P' ) { allPass(auctionTree); continue; }
		
		addCall(auctionTree, calls, rs[i].explains, 0);
	}
	
	return auctionTree;
	
	// Called recursively. Don't have pointers in JavaScript so forced into
	// explicit recursion.
	function addCall(currentNode, calls, explains, ix) {
		let call = calls[ix];
		// Trim any trailing ! for alerts.
		if (call.length === 3) { call = call.substr(0,2); }
		else if (call.charAt(1) === '!') { call = call.charAt(0); }
		
		if ( !currentNode.children[call] ) {
			// Need this as a secondary sorting criterion.
			let callsort = call.length === 2 ? call : call === 'P' ? '0P' : '0R'; 
			currentNode.children[call] = 
				{ 'call': call, 'callsort': callsort, 'cnt': 1, 'children': {} };
		}
		else {
			currentNode.children[call].cnt++;
		}
		
		if (explains !== undefined && explains[call] !== undefined) {
			let explanation = explains[call];
			if ( currentNode.children[call].explanations === undefined ) { 
				currentNode.children[call].explanations = [];
			}
			currentNode.children[call].explanations.push(explanation);
		} 
		
		// -4 because we ignore the final three passes.
		if (ix < calls.length-4) {
			addCall(currentNode.children[call], calls, explains, ix+1);
		}
		else { allPass(currentNode.children[call]); }
	}
	
	function allPass(node) {
		// All Pass pseudo call
		if ( !node.children['AP'] ) {
			node.children['AP'] = 
				{ 'call': 'AP', 'callsort': '00', 'cnt': 1, 'children': {} };
		}
		else { node.children['AP'].cnt++; }
	}
}

function suithtml(suit) {
	const suithtml2 = ['<span class="ss2">&spades;</span>', '<span class="hs2">&hearts;</span>', 
		'<span class="ds2">&diams;</span>', '<span class="cs2">&clubs;</span>'];
	const suithtml4 = ['<span class="ss4">&spades;</span>', '<span class="hs4">&hearts;</span>', 
		'<span class="ds4">&diams;</span>', '<span class="cs4">&clubs;</span>'];
	
	let ix = (suit === 'S') ? 0 : (suit === 'H') ? 1 : (suit === 'D') ? 2 : 
		(suit === 'C') ? 3 : undefined;
	if (ix === undefined) { return; } 
	return pref.travSuitFourColor ? suithtml4[ix] : suithtml2[ix];
}

function linparse(lin) {
	let r = {};
	let calls = [], explains = {}, auctionhtml = '', auctionsort = '';
	let val, lead, leadhtml, anyExplanations = false;
	
	let lc = lin.substr(0,lin.length-1).split('|');

	for (let i=0; i<lc.length; i+=2) {
		val = lc[i+1];
		
		switch ( lc[i] ) {
		case 'mb':
			// Normally bids are uppercase and pass, double, and redouble are lowercase
			// ('p', 'd', 'r'') but Thorvald Aagaard send me a case where he was replaying
			// Vugraph hands where the calls were lowercase. It seems BBO does not 
			// standardize the case of VuGraph operator entered calls.
			val = val.toUpperCase();
			
			// Leave trailing ! for alert in here.
			calls.push(val);
			
			// Removing trailing ! if present here.
			if ( val.substr(-1) === '!' ) { val = val.substr(0, val.length-1); }
			
			if ( val === 'P' ) {
				auctionhtml += ' P';
				auctionsort += '0P';
			}
			else if ( val === 'D' ) {
				auctionhtml += ' X';
				auctionsort += '0R'
			}
			else if ( val === 'R') {
				auctionhtml += ' XX';
				auctionsort += '0R';
			}
			else if ( val.charAt(1) === 'N' ) {
				auctionhtml += ' ' + val;
				// Needs to be lexicographically greater than S (spades)
				auctionsort += val.charAt(0) + 'T';
			}
			else {
				// Suit bid
				auctionhtml += ' ' + val.charAt(0) + suithtml(val.charAt(1));
				auctionsort += val;
			}
			if (calls.length % 4 === 0) { auctionhtml += ' |'; }
			break;
			
		case 'an':
			let explanation = val.trim();
			if (explanation === '' || explanation === 'No explanation available') { break; }
			
			anyExplanations = true;
			let call = calls[ calls.length-1 ];
			if ( call.endsWith('!') ) { call = call.substr(0, call.length-1); }
			explains[ calls[calls.length-1] ] = explanation;
			// console.log('call', call, explanation);
			break;
			
		case 'pc':
			if (lead === undefined) {
				lead = val.toUpperCase();
				leadhtml = suithtml(lead.charAt(0)) + lead.charAt(1);
			}
			break;
			
		case 'pn':
			r.pnames = val.split(',');
			break;
			
		case 'md':
			r.hand3 = val;
			break;
			
		case 'ah':
			r.bnum = parseInt( val.split(' ')[1] );
			break;
		}
	}
	
	// If the auction was completed, trim final three passes from auctionHTML.
	const ncalls = calls.length;
	if (ncalls >= 4 && calls[ncalls-1] === 'P' && calls[ncalls-2] === 'P' && 
		calls[ncalls-3] ===  'P') {
			
		if (ncalls === 4 && calls[0] === 'P') { auctionhtml = 'Pass Out'; }
		else auctionhtml = auctionhtml.substr(1, auctionhtml.length-9);
	}
	

	// If bidding was not reached, we want to sort it at the end.
	if (calls.length === 0) { auctionsort = 'Z'; }
	
	if (lead === undefined) { leadhtml = ''; }
	
	// Don't waste memory on a bunch of empty objects.
	r.explains = anyExplanations ? explains : undefined;
	
	r.calls = calls; r.auctionsort = auctionsort; r.auctionhtml = auctionhtml;
	r.lead = lead; r.leadhtml = leadhtml;
	
	return r;
}

function escapeHTML(s) {
	// This function forces the work onto the compiled C++ code in the browser.
	// It's faster than doing string replace on <, >, &, ", etc in JavaScript.
	app.textarea.textContent = s;
	return app.textarea.innerHTML;
}

function showExplanations(e) {
	
	let tg = e.currentTarget;
	let html;
	
	let dv = document.getElementById('explaintp');
	if (dv === null) {
		// Create it for the first time.
		dv = document.createElement('div');
		dv.id = 'explaintp';
		dv.style.display = 'none';
		
		// Add the close button.
		let imgCloseURL = browser.runtime.getURL("buttons/close-button-32.png");
		
		let btClose = document.createElement('button');
		btClose.style = 'float: right; border: none';
		btClose.innerHTML = `<img src="${imgCloseURL}">`;
		btClose.addEventListener("click", () => { dv.style.display = 'none'; }, false);
		dv.appendChild(btClose);
		
		let dp = document.createElement('p');
		dp.id = 'explaintpTitle';
		dp.innerText = 'Explanations';
		dv.appendChild(dp);
		
		// Will hold the explanations and hits
		let dvc = document.createElement('div');
		dvc.id = 'explaintpContent';
		dv.appendChild(dvc);
		
		document.body.appendChild(dv);
	}
	
	if (app.explainEl === tg) {
		// Just toggle the state of the the display.
		dv.style.display = dv.style.display === '' ? 'none' : '';
		return;
	}
	
	// Otherwise we need to display explanations for a new call.
	
	if (tg.explanationHTML !== undefined) {
		html = tg.explanationHTML;
	}
	else {	
		// First time user has click on the call. Build up the HTML.
		
		// Begin by adding exclamation marks to bare suit symbols first so that we can 
		// consolidate explanations like 'h + s' and '!h + !s' as the same explanation.
		const rg = /(?<![a-zA-Z!])([cdhs])(?![a-zA-Z])/gi;
		let exp = tg.explanations.map( (a) => a.replace(rg, '!$1') );
		
		// Expand out some abbreviations and correct common misspellings.
		exp = expCorrections(exp);
		
		exp = exp.sort( (a,b) => a.toLowerCase() > b.toLowerCase() ? 1 : -1 );
		
		// Reduce to unique entries (case insensitive).
		let uqexp = [], uqcnt = [];
		for (let i=1, currexp = exp[0], cnt=1; i<=exp.length; i++) {
			if ( i < exp.length && currexp.toLowerCase() === exp[i].toLowerCase() ) { 
				cnt++; continue;
			}
			
			uqexp.push(currexp); uqcnt.push(cnt);
			currexp = exp[i]; cnt = 1;
		}
		
		html = '<div id="explanations">\n';
		for (let i=0; i<uqexp.length; i++) {
			html += '<span class="exp">' + escapeHTML( uqexp[i] );
			if ( uqcnt[i] !== 1 ) { html += ' <span class="expcnt">(' + uqcnt[i] + 'x)</span>'; }
			html += '</span><br>\n'; 
		}
		html += '</div>\n';
		
		// Now replace !c, !d, !h, and !s with suit symbols.
		html = html.replace(/!c/gi, suithtml('C'));
		html = html.replace(/!d/gi, suithtml('D'));
		html = html.replace(/!h/gi, suithtml('H'));
		html = html.replace(/!s/gi, suithtml('S'));
		
		const hintHeader = '<p id="explaintpHint">Hints</p>\n';
		
		let hints = abbrHints( uqexp.join('\n'), tg.dataset.call );
		if ( hints.length !== 0 ) { html += '\n' + hintHeader + hints; }
	}
	
	document.getElementById('explaintpContent').innerHTML = html;
	dv.style.display = '';
	
	// Position the explanation below the <div> containing the call (i.e. TG). This
	// isn't as straightforward as you would think because absolute positioning only
	// works relative to an absolutely positioned parent (but the <div> and parent
	// <td> are statically positioned).
	let offsetLeft = 0, offsetTop = 0, el = tg.parentElement;  // <td>
	do {
		// console.log(el.tagName, el.offsetLeft, el.offsetTop);
		// Small negative offsets creep in here due to nested table structure that
		// we need to ignore.
		if (el.offsetLeft !== undefined && el.offsetLeft > 0) { offsetLeft += el.offsetLeft; }
		if (el.offsetTop !== undefined && el.offsetTop > 0) { offsetTop += el.offsetTop; }
		el = el.offsetParent;
	}
	while (el);

	dv.style.left = (offsetLeft + 4) + 'px';
	dv.style.top  = (offsetTop + tg.offsetHeight + 8) + 'px';
	
	app.explainEl = tg;
}

function expCorrections(exp) {
	// Expand some explanation abbreviations to full word and correct some
	// misspellings.

	// '6hearts' --> '6 hearts' and similar
	exp = exp.map( (a) => a.replace(/(\d)(club|diamond|heart|spade)/gi, '$1 $2' ) );

	// '15to17' --> '15 to 17' and similar
	exp = exp.map( (a) => a.replace(/(\d)to(\d)/gi, '$1 to $2' ) );

	// Normalize spelling of 'preempt' (somewhat common case)
	exp = exp.map( (a) => a.replace(/pre[\- ]e?mpt/gi, 'preempt') );

	// Common misspelling of 'weak'
	exp = exp.map( (a) => a.replace(/(?<!\w)week(?!\w)/gi, 'weak') );

	// Common abbreviation for 'forcing'
	exp = exp.map( (a) => a.replace(/(?<!\w)forc(?!\w)/gi, 'forcing') );

	// Common abbreviation for 'forcing'
	exp = exp.map( (a) => a.replace(/(?<!\w)art(?!\w)/gi, 'artificial') );

	// Common abbreviation for 'forcing'
	exp = exp.map( (a) => a.replace(/(?<!\w)xf(er)?(?!\w)/gi, 'Transfer') );

	// Common abbreviation for 'diamond'
	exp = exp.map( (a) => a.replace(/(?<!\w)dia(?!\w)/gi, 'diamond') );

	// Common abbreviation for 'majors'
	exp = exp.map( (a) => a.replace(/(?<!\w)maj(?!\w)/gi, 'majors') );

	// Common abbreviation for 'support'
	exp = exp.map( (a) => a.replace(/(?<!\w)supp(?!\w)/gi, 'support') );

	// Common abbreviation for 'natural'
	exp = exp.map( (a) => a.replace(/(?<!\w)nat(?!\w)/gi, 'natural') );

	// Common abbreviation for 'Lebensohl'
	exp = exp.map( (a) => a.replace(/(?<!\w)leb(?!\w)/gi, 'Lebensohl') );

	// Common misspellings of 'Cappelletti'
	exp = exp.map( (a) => a.replace(/(?<!\w)capp?[ae]ll?ett?i(?!\w)/gi, 'Cappelletti') );	

	// Common misspellings of 'Stayman'
	exp = exp.map( (a) => a.replace(/(?<!\w)sta?y?m[ae]n(?!\w)/gi, 'Stayman') );	
	
	return exp;
}

function abbrHints(str, call) {
	// Provides hints (as HTML) for commonly used abbreviations in alert explanations.
	
	// Third field in each entry is optional. If specified, it means the hint should
	// only be provided for the specified call (if a string) or calls (if an array). 
	const ab = [
		['10-12', '(<a <a href="https://bridge.fandom.com/wiki/One_notrump/opening" ' +
			'target="_blank"">Kamikaze Notrump</a>)', '1N'],
		['12-14', '(<a <a href="https://bridge.fandom.com/wiki/One_notrump/opening" ' +
			'target="_blank"">Weak Notrump</a>)', '1N'],
		['16-18', 'Notrump range (15-17 is most common for ACBL players ' + 
			'and the assumed default)', '1N'],
		['16+', '<a href="https://www.bridgehands.com/Conventions/Precision_Big_Club.htm" ' +
			'target="_blank"">Precision bidding system 1&clubs; bid</a>', '1C'],
		['11-15', '<a href="https://www.bridgehands.com/Conventions/Precision_Big_Club.htm" ' +
			'target="_blank"">Precision bidding system</a> major suit opener', ['1H', '1S'] ],
		['2+', 'Probably a <a href="https://www.bridgehands.com/Conventions/Precision_Big_Club.htm" ' +
			'target="_blank"">Precision bidding system</a> 2&diams; opener', '1D' ],
		['3014', 'Version of <a href="https://kwbridge.com/rkc.htm" ' +
			'target="_blank"">Roman Keycard Blackwood</a>'],
		['1430', 'Version of <a href="https://kwbridge.com/rkc.htm" ' +
			'target="_blank"">Roman Keycard Blackwood</a>'],
		['4SF', '<a href="https://www.bridgehands.com/F/Fourth_Suit_Forcing.htm" ' +
			'target="_blank">Fourth Suit Forcing</a>'],
		['Artificial', 'Says nothing about suit bid'],	
		['Bailey', '<a href="https://lajollabridge.com/Bailey/topics/may11.htm" ' +
			'target="_blank">Bailey Weak Two</a>', ['2D', '2H', '2S'] ],
		['Bergen', '<a href="https://www.bridgebum.com/bergen_raises.php" ' +
			'target="_blank">Bergen Raise</a>', ['3C', '3D', '3H', '3S'] ],
		['Brozel', '<a href="https://www.bridgebum.com/brozel.php" ' +
			'target="_blank">Brozel defense to 1NT</a>'],
		['Capp', '<a href="https://www.bridgebum.com/cappelletti.php" ' +
			'target="_blank">Cappelletti (aka Hamilton) defense to 1NT</a>'],
		['Cappelletti', '<a href="https://www.bridgebum.com/cappelletti.php" ' +
			'target="_blank">Cappelletti (aka Hamilton) defense to 1NT</a>'],
		['DONT', '<a href="https://kwbridge.com/dont.htm" ' +
			'target="_blank">Disturbing Opponent&rsquo;s Notrump defense to 1NT</a>'],
		['Drury', '<a href="https://www.bridgebum.com/drury.php" ' +
			'target="_blank">Limit Raise across from a passed hand</a>', ['2C', '2D'] ],
		['ELC', '<a href="https://www.bridgebum.com/equal_level_conversion.php" ' +
			'target="_blank">Equal Level Conversion</a>', '2D'],						
		['Flannery', '<a href="https://www.bridgebum.com/flannery_2d.php" ' +
			'target="_blank">Flannery 2&diams; Opening Bid</a>', '2D'],
		['f', 'Forcing'],
		['f1', 'Forcing for one round'],
		['Feature', 'Ace or king'],
		['gf', 'Game Forcing'],
		['Gerber', '<a href="https://www.bridgebum.com/gerber.php" ' +
			'target="_blank">Ace asking in response to a notrump opener', ['1N', '2N'] ],
		['Gambling', '<a href="https://www.bridgebum.com/gambling_3nt.php" ' +
			'target="_blank">Gambling 3NT convention</a>', '3N'],
		['Hamilton', '<a href="https://www.bridgebum.com/cappelletti.php" ' +
			'target="_blank">Cappelletti (aka Hamilton) defense to 1NT</a>'],
		['Inverted', '<a href="https://www.bridgebum.com/inverted_minors.php" ' +
			'target="_blank">Inverted Minor Raise</a>', ['2C', '2D', '3C', '3D'] ],
		['Jacoby', '<a href="https://kwbridge.com/jac2nt.htm" ' +
			'target="_blank">Forcing Major-Suit Raise</a>', '2N'],
		['Jordan', '<a href="https://www.bridgebum.com/jordan_2nt.php" ' +
			'target="_blank">Limit raise or better after an opposing takeout double</a>', '2N'],			
		['lim+', 'Limit Raise or better'],
		['LR+', 'Limit Raise or better'],
		['Maximal', '<a href="https://www.bridgebum.com/maximal_double.php" ' +
			'target="_blank">Maximal Double</a>', 'D'],
		['Multi', '<a href="https://www.bridgebum.com/multi_2d.php" ' +
			'target="_blank">Multi 2&diams; Opener</a>', '2D'],
		['MSS', '<a href="https://www.bridgebum.com/minor_suit_stayman.php" ' +
			'target="_blank">Minor Suit Stayman</a>', ['2S', '3S'] ],
		['natural', 'Shows suit bid'],
		['nf', 'Non-forcing'],
		['FSF', '<a href="https://www.bridgehands.com/F/Fourth_Suit_Forcing.htm" ' +
			'target="_blank">Fourth Suit Forcing</a>'],
		['Lebensohl', '<a href="https://www.bridgebum.com/lebensohl_after_1nt.php" ' + 
			'target="_blank"">Method of handling interference over a 1NT opening bid</a>', '2N'],
		['Michaels', '<a href="https://kwbridge.com/michaels.htm" ' + 
			'target="_blank"">Michaels cue bid</a>'],
		['Mixed', '<a href="https://kwbridge.com/mixed.htm" ' +
			'target="_blank"">Mixed Raise</a>'],
		['Negative', '<a href="https://www.bridgebum.com/negative_double.php" ' +
			'target="_blank"">Negative Double</a>', 'D'],
		['Negative', 'Poor hand across from a strong 1&clubs; opener', '1D'],
		['NMF', '<a href="https://kwbridge.com/nmf.htm" ' +
			'target="_blank"">New Minor Forcing</a>'],
		['OGUST', '<a href="https://www.bridgebum.com/ogust.php" ' +
			'target="_blank"">Asks for Weak Two bidder&rsquo;s hand strength and suit quality</a>'],
		['Pup', '<a href="https://www.bridgebum.com/ogust.php" ' +
			'target="_blank"">Puppet Stayman</a>', '3C'],
		['Puppet', '<a href="https://acbl.com/puppet-stayman/" ' +
			'target="_blank"">Puppet Stayman</a>', '3C'],
		['Responsive', '<a href="https://www.bridgebum.com/responsive_double.php" ' +
			'target="_blank">Responsive Double</a>', 'D'],			
		['RKC', '<a href="https://kwbridge.com/rkc.htm" ' +
			'target="_blank"">Roman Keycard Blackwood</a>'],
		['RKCB', '<a href="https://kwbridge.com/rkc.htm" ' +
			'target="_blank"">Roman Keycard Blackwood</a>'],
		['Roman key', '<a href="https://kwbridge.com/rkc.htm" ' +
			'target="_blank"">Roman Keycard Blackwood</a>'],
		['Semi forcing', 'Partner is allowed to pass with a minimum', '1N'],
		['short', '<a href="https://www.answers.com/Q/' + 
			'In_bridge_what_is_a_short_club_and_how_do_you_answer" ' +
			'target="_blank"">Short Club agreement</a>', '1C'],		
		['Smolen', 'Shows 5-4 or 4-5 in the majors across from a 1NT opener', ['3H', '3S'] ],
		['Splinter', '<a href="https://www.bridgebum.com/splinters.php" ' +
			'target="_blank"">Support and shortness in suit bid</a>'],
		['Sandwich', '<a href="https://www.bridgebum.com/sandwich_1nt.php" ' +
			'target="_blank"">Sandwich Notrump (distributional two suiter)</a>', '1N'],
		['Super Accept', '<a href="https://bridge-tips.co.il/wp-content/uploads/' +
			'2017/05/Super-Acceptance-of-%E2%80%9CJacoby-Transfers%E2%80%9D.pdf" ' +
			'target="_blank"">Maximum hand with 4+ card support for responder&rsquo;s suit</a>', 
			['3H', '3S'] ],
		['Support', '<a href="https://www.bridgebum.com/support_double.php" ' +
			'target="_blank"">3 card support by opener of responder&rsquo;s suit</a>', ['D', 'R'] ],
		['Stolen', '<a href="https://lajollabridge.com/LJUnit/Education/AgainstStolenBids.pdf" ' +
			'target="_blank"">Stolen Bid</a>'],
		['t/o', 'Takeout', 'D'],			
		['Transfer', '<a href="http://www.omahabridge.org/Library/MH_FourSuitTransfers.pdf" ' +
			'target="_blank"">Four Suit Transfers</a>', '2N'],		
		['Texas', '<a href="https://www.bridgebum.com/texas_transfer.php" ' +
			'target="_blank"">Texas Transfer</a>'],			
		['Unusual', '<a href="https://kwbridge.com/michaels.htm" ' + 
			'target="_blank"">Unusual Notrump</a>', '2N'],
		['Waiting', '<a href="https://www.bridgebum.com/strong_2c.php" ' +
			'target="_blank">Lets 2&clubs; opener further show hand</a>', '2D'],				
		['Wolf', '<a href="https://www.bridgehands.com/W/Wolff_Signoff.htm" ' +
			'target="_blank"">Wollf Signoff</a>'],
		['Wolff', '<a href="https://www.bridgehands.com/W/Wolff_Signoff.htm" ' +
			'target="_blank"">Wollf Signoff</a>'],			
		['WJO', 'Weak Jump Overcall']
	];
	
	str = str.toLowerCase();
	let hints = '';
	
	for (let i=0; i<ab.length; i++) {
		const abb = ab[i][0].toLowerCase();
		// Have to escape regular expression meaning of + in 'lim+' and 'LR+'
		const rgabb = abb.replace('+', '\\+');
		let rg = new RegExp( '(?<!\\w)' + rgabb + '(?!\\w)' );
		if ( str.match(rg) === null ) { continue; }
			
		// Some hints only apply to certain call(s).
		let allowedCalls = ab[i][2];
		if (allowedCalls !== undefined) {
			if (typeof allowedCalls === 'string') {
				if (allowedCalls !== call) { continue; }
			}
			else if (allowedCalls.indexOf(call) === -1) { continue; } 
		}
		
		hints += '<span class="abb">' + ab[i][0] + '</span>' + ' = ' + ab[i][1] + '<br>\n';
	}
	
	return hints;
}