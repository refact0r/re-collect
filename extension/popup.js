import {
	getHomePreferences,
	getLastCollection,
	getSettings,
	listCollections,
	savedNote,
	setLastCollection
} from './api.js';

const select = document.getElementById('collection');
const image = document.getElementById('image');
const tagging = document.getElementById('tagging');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById('title').textContent = tab.title;
document.getElementById('url').textContent = tab.url;

if (!(await getSettings()).convexUrl) {
	status.innerHTML = 'Not configured — <a href="#" id="open-options">open options</a>';
	document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
} else if (!/^https?:/.test(tab.url ?? '')) {
	status.textContent = "This page can't be saved";
} else {
	loadCollections();
	warnIfSaved();
}

let collections = [];
let home = null;
let loaded = false;

// Save is enabled only once the select is filled, so an Enter right after
// opening can't save to Uncollected (and make that the last collection). If
// the list can't load, saving still works but leaves the last collection alone.
async function loadCollections() {
	try {
		const last = await getLastCollection();
		[collections, home] = await Promise.all([listCollections(), getHomePreferences()]);
		select.append(...collections.map((c) => new Option(c.name, c._id)));
		if (collections.some((c) => c._id === last.id)) select.value = last.id;
		showDefaults();
		loaded = true;
	} catch (error) {
		status.textContent = `Couldn't load collections: ${error.message}`;
		status.classList.add('error');
	}
	saveButton.disabled = false;
	saveButton.focus();
}

// Saving again is allowed; the button says so
async function warnIfSaved() {
	const note = await savedNote(tab.url);
	if (!note || status.classList.contains('error')) return;
	status.textContent = note;
	saveButton.textContent = 'Save again';
}

// The "Default" options name what the selected collection (or home) would use
function showDefaults() {
	const source = collections.find((c) => c._id === select.value) ?? home;
	document.getElementById('default-image').text =
		`Default image (${source?.linkImageMode === 'og' ? 'og image' : 'screenshot'})`;
	const understood = { visual: 'by look', text: 'by content', none: 'AI off' };
	document.getElementById('default-tagging').text =
		`Default (${understood[source?.taggingMode ?? 'visual']})`;
}
select.onchange = showDefaults;

// The background worker does the save (and any area selection, which needs
// the popup out of the way) and reports back with a toast in the page
saveButton.onclick = async () => {
	const collectionId = select.value;
	const name = collectionId ? select.selectedOptions[0].text : '';
	const capture = ['visible', 'area'].includes(image.value) ? image.value : 'auto';
	if (loaded) await setLastCollection({ id: collectionId, name });
	await chrome.runtime.sendMessage({
		type: 'savePage',
		tabId: tab.id,
		collectionId,
		capture,
		overrides: {
			taggingMode: tagging.value || undefined,
			linkImageMode: capture === 'auto' ? image.value || undefined : undefined
		}
	});
	window.close();
};
