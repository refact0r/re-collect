import { getLastCollection, getSettings, listCollections, setLastCollection } from './api.js';

const select = document.getElementById('collection');
const capture = document.getElementById('capture');
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
	saveButton.disabled = false;
	saveButton.focus();
	loadCollections();
}

async function loadCollections() {
	try {
		const [collections, last] = await Promise.all([listCollections(), getLastCollection()]);
		select.append(...collections.map((c) => new Option(c.name, c._id)));
		if (collections.some((c) => c._id === last.id)) select.value = last.id;
	} catch (error) {
		status.textContent = `Couldn't load collections: ${error.message}`;
		status.classList.add('error');
	}
}

// The background worker does the save (and any area selection, which needs
// the popup out of the way) and reports back with a toast in the page
saveButton.onclick = async () => {
	const collectionId = select.value;
	const name = collectionId ? select.selectedOptions[0].text : '';
	await setLastCollection({ id: collectionId, name });
	await chrome.runtime.sendMessage({
		type: 'savePage',
		tabId: tab.id,
		collectionId,
		capture: capture.value
	});
	window.close();
};
