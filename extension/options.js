import { getMe, getSettings } from './api.js';

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
	const next = { convexUrl: convexUrl.value.trim(), token: token.value.trim() };
	// A different account (or deployment) won't have the last-used collection
	const changed = next.convexUrl !== settings.convexUrl || next.token !== settings.token;
	await chrome.storage.local.set(next);
	if (changed) await chrome.storage.local.remove('lastCollection');
	Object.assign(settings, next);

	try {
		const { username } = await getMe();
		status.textContent = `Saved — signed in as ${username}`;
	} catch (error) {
		status.textContent = `Saved, but couldn't connect: ${error.message}`;
		status.classList.add('error');
	}
};
