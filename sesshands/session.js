const pref2class = { "boardShowPlay" : "bh-cardplay", 
	"boardShowExplanations" : "bh-explanations", "boardShowLinks" : "bh-links",
	"boardShowAuction" : "bh-auction", "boardShowDoubleDummy" : "bh-dd-par", 
	"boardShowContract" : "bh-contract", "boardShowHCP" : "bh-hcp",
	"boardShowScore" : "hb-score" };

window.onload = function () {
	
	// Initialize state of all checkboxes
	const prefnames = Object.keys(pref);
	prefnames.forEach( p => { 
		const el = document.getElementById(p);
		if (el !== null) { el.checked = pref[p]; }
	});
	
	// Initialize the display to match user's preferences at the time the HTML
	// was created.
	timing();
	suitcolors();
	boundingbox();
	
	for ( const [id, className] of Object.entries(pref2class) ) { 
		classShowHide(className, id);
	}
};

document.addEventListener("change", (e) => {
	// "change" events occurs when the content of a form element, the selection, or 
	// the checked state have changed (for <input>, <select>, and <textarea>).
	
	let id = e.target.id;
	
	if (e.target.type !== 'checkbox') { return; }
	
	pref[id] = e.target.checked;
	
	if (id === 'suitFourColor') { suitcolors(); }
	else if (id === 'boardIncludeBorder') { boundingbox(); }
	else if (id === 'boardShowTiming') { timing(); }
	else {
		const className = pref2class[id];
		if (className !== undefined) { classShowHide(className, id); }
	}

});

function suitcolors() {
	
	const suit2color = ['black', 'red', 'red', 'black'];
	const suit4color = ['#2c399f', 'red', '#e86e23', '#40813f'];
	
	const colors = pref.suitFourColor ? suit4color : suit2color;
	const suitStyles = ['ss', 'hs', 'ds', 'cs'];
	
	for (i=0; i<4; i++) {
		const matches = document.querySelectorAll('.' + suitStyles[i]);
		matches.forEach( el => { el.style.color = colors[i]; } );
	}
	
}

function boundingbox() {
	
	const border = pref.boardIncludeBorder ? '1px solid #777' : 'none';
	
	const matches = document.querySelectorAll('.' + 'bh-board');
	matches.forEach( dv => { dv.style.border = border; } );
	
};

function timing() {
	// If no boards have timing information, this preference is excluded and there
	// is nothing to do.
	if (pref.boardShowTiming === undefined) { return; }

	// Adjust cardplay table
	const dispval = pref.boardShowTiming ? '' : 'none';
	matches = document.querySelectorAll('.tm');
	matches.forEach( el => { el.style.display = dispval; } );
	
	const width = pref.boardShowTiming ? '3em' : '2em';
	const colspan = pref.boardShowTiming ? 2 : 1;
	matches = document.querySelectorAll('.bh-cardtm th');
	matches.forEach( el => {
		el.style.width = width;
		el.setAttribute('colspan', colspan);
	});

	matches = document.querySelectorAll('.bh-cardtm .timesum td');
	matches.forEach( el => { el.setAttribute('colspan', colspan); } );
	
	const seats = pref.boardShowTiming ? ['West', 'North', 'East', 'South'] : ['W', 'N', 'E', 'S'];
	for (i=0; i<4; i++) {
		matches = document.querySelectorAll(`.bh-cardtm th:nth-child(${i+1})`);
		matches.forEach( el => { el.innerText = seats[i]; } );
	}
	
	// Adjust auction box
	matches = document.querySelectorAll('.tma');
	matches.forEach( el => { el.style.display = dispval; } );
	
	matches = document.querySelectorAll('.bh-auctiontm th');
	matches.forEach( el => { el.setAttribute('colspan', colspan); } );	
}

function classShowHide(className, p) {
	// Display or hide HTML elements of a class based on preference P
	const val = pref[p] ? '' : 'none';
	const matches = document.querySelectorAll('.' + className);
	matches.forEach( el => { el.style.display = val; } );
}
