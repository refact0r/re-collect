import { getSettings, listCollections } from './api.js';

const form = document.getElementById('form');
const convexUrl = document.getElementById('convexUrl');
const token = document.getElementById('token');
const status = document.getElementById('status');

const settings = await getSettings();
convexUrl.value = settings.convexUrl;
token.value = settings.token;

form.onsubmit = async (event) => {
	event.preventDefault();
	status.classList.remove('error');
	await chrome.storage.local.set({ convexUrl: convexUrl.value.trim(), token: token.value.trim() });
	// Only checks the URL — there's no read-only endpoint to validate the token against
	try {
		const collections = await listCollections();
		status.textContent = `Saved — connected, ${collections.length} collections`;
	} catch (error) {
		status.textContent = `Saved, but couldn't connect: ${error.message}`;
		status.classList.add('error');
	}
};
