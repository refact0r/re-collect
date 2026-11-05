import { getLastCollection, saveImage, saveUrl } from './api.js';

const MENUS = [
	{ id: 'page', contexts: ['page'], label: 'page' },
	{ id: 'link', contexts: ['link'], label: 'link' },
	{ id: 'image', contexts: ['image'], label: 'image' }
];

async function updateMenuTitles() {
	const { name } = await getLastCollection();
	const target = name ? `“${name}”` : 're-collect';
	for (const menu of MENUS) {
		chrome.contextMenus.update(menu.id, { title: `Save ${menu.label} to ${target}` });
	}
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		for (const { id, contexts } of MENUS) {
			chrome.contextMenus.create({ id, contexts, title: id });
		}
		updateMenuTitles();
	});
});

chrome.storage.onChanged.addListener((changes) => {
	if (changes.lastCollection) updateMenuTitles();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	const { id: collectionId } = await getLastCollection();
	try {
		if (info.menuItemId === 'image') {
			const { type } = await saveImage({
				imageUrl: info.srcUrl,
				pageUrl: info.pageUrl,
				collectionId
			});
			notify(tab, true, type === 'image' ? 'Image saved' : 'Image blocked — saved page instead');
		} else if (info.menuItemId === 'link') {
			// linkText is Firefox-only; the screenshot worker fills in titles otherwise
			await saveUrl({ url: info.linkUrl, title: info.linkText, collectionId });
			notify(tab, true, 'Link saved');
		} else {
			await saveUrl({ url: tab.url, title: tab.title, collectionId });
			notify(tab, true, 'Page saved');
		}
	} catch (error) {
		notify(tab, false, error.message);
	}
});

// Badge on the toolbar icon, plus a toast in the page where scripting is allowed
function notify(tab, ok, message) {
	if (!tab?.id) return;
	const tabId = tab.id;
	chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#2f9e44' : '#e03131' });
	chrome.action.setBadgeText({ tabId, text: ok ? '✓' : '!' });
	setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 3000);

	chrome.scripting
		.executeScript({ target: { tabId }, func: showToast, args: [ok, message] })
		.catch(() => {});
}

// Runs in the page; self-contained and shadow-DOM-isolated from page styles
function showToast(ok, message) {
	document.getElementById('re-collect-toast')?.remove();
	const host = document.createElement('div');
	host.id = 're-collect-toast';
	const shadow = host.attachShadow({ mode: 'closed' });
	const toast = document.createElement('div');
	toast.textContent = `${ok ? '✓' : '✕'} ${message}`;
	toast.style.cssText = `
		position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
		max-width: 320px; padding: 8px 12px;
		font: 14px/1.4 system-ui, sans-serif; color: #e6e6e6;
		background: #1f1f1f; border: 1px solid ${ok ? '#333' : '#8a3b3b'};
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
		transition: opacity 0.3s;
	`;
	shadow.append(toast);
	document.documentElement.append(host);
	setTimeout(() => (toast.style.opacity = '0'), 2500);
	setTimeout(() => host.remove(), 2800);
}
