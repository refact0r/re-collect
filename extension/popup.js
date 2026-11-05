import {
	getLastCollection,
	getSettings,
	listCollections,
	saveUrl,
	setLastCollection
} from './api.js';

const select = document.getElementById('collection');
const saveButton = document.getElementById('save');
const status = document.getElementById('status');

function setStatus(message, isError = false) {
	status.textContent = message;
	status.classList.toggle('error', isError);
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById('title').textContent = tab.title;
document.getElementById('url').textContent = tab.url;

if (!(await getSettings()).convexUrl) {
	status.innerHTML = 'Not configured — <a href="#" id="open-options">open options</a>';
	document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
} else if (!/^https?:/.test(tab.url ?? '')) {
	setStatus("This page can't be saved");
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
		setStatus(`Couldn't load collections: ${error.message}`, true);
	}
}

saveButton.onclick = async () => {
	saveButton.disabled = true;
	setStatus('Saving…');
	const collectionId = select.value;
	const name = collectionId ? select.selectedOptions[0].text : '';
	try {
		await setLastCollection({ id: collectionId, name });
		await saveUrl({ url: tab.url, title: tab.title, collectionId });
		setStatus(name ? `Saved to ${name}` : 'Saved');
		setTimeout(() => window.close(), 800);
	} catch (error) {
		setStatus(error.message, true);
		saveButton.disabled = false;
	}
};
