import { getLastCollection, saveImage, savePageWithImage, savedNote, saveUrl } from './api.js';

// Page saves take their image from the worker by default ('auto'), or from a
// screenshot taken here of the visible area or a dragged-out region
const MENUS = [
	{ id: 'page:auto', contexts: ['all'], title: 'Page' },
	{ id: 'page:visible', contexts: ['all'], title: 'Page (screenshot visible area)' },
	{ id: 'page:area', contexts: ['all'], title: 'Page (screenshot selected area…)' },
	// Only http(s) links can be saved (mailto:, javascript: … would be rejected)
	{
		id: 'link',
		contexts: ['link'],
		targetUrlPatterns: ['http://*/*', 'https://*/*'],
		title: 'Link'
	},
	{ id: 'image', contexts: ['image'], title: 'Image' }
];

async function updateRootTitle() {
	const { name } = await getLastCollection();
	chrome.contextMenus.update('root', { title: `Save to ${name ? `“${name}”` : 're-collect'}` });
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'root', contexts: ['all'], title: 'Save to re-collect' });
		for (const menu of MENUS) chrome.contextMenus.create({ ...menu, parentId: 'root' });
		updateRootTitle();
	});
});

chrome.storage.onChanged.addListener((changes) => {
	if (changes.lastCollection) updateRootTitle();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	const { id: collectionId } = await getLastCollection();
	const [kind, capture] = String(info.menuItemId).split(':');
	await run(tab, async () => {
		if (kind === 'image') {
			const { type } = await saveImage({
				imageUrl: info.srcUrl,
				pageUrl: info.pageUrl,
				collectionId
			});
			return type === 'image' ? 'Image saved' : 'Image blocked — saved page instead';
		}
		if (!(await confirmIfSaved(tab, kind === 'link' ? info.linkUrl : tab.url))) return null;
		if (kind === 'link') {
			// linkText is Firefox-only; the screenshot worker fills in titles otherwise
			await saveUrl({ url: info.linkUrl, title: info.linkText, collectionId });
			return 'Link saved';
		}
		return savePage(tab, collectionId, capture);
	});
});

// A page or link already in the library is saved again only once the user OKs
// it in the page. Where scripting isn't allowed it just saves. (The popup shows
// its own warning before you click save.)
async function confirmIfSaved(tab, url) {
	const note = await savedNote(url);
	if (!note) return true;
	return inject(tab, (message) => confirm(message), [
		`${note} in re-collect. Save it again?`
	]).catch(() => true);
}

// The popup hands saves off here so area selection can happen after it closes
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type !== 'savePage') return;
	const { tabId, collectionId, capture, overrides } = message;
	chrome.tabs
		.get(tabId)
		.then((tab) => run(tab, () => savePage(tab, collectionId, capture, overrides)));
	sendResponse();
});

// Resolves to a confirmation message, or null if the user cancelled.
// `overrides` ({ taggingMode, linkImageMode }) replace the collection's defaults.
async function savePage(tab, collectionId, capture, overrides = {}) {
	if (capture === 'auto') {
		await saveUrl({ url: tab.url, title: tab.title, collectionId, ...overrides });
		return 'Page saved';
	}

	const area = capture === 'area' ? await inject(tab, selectArea) : null;
	if (capture === 'area' && !area) return null;
	const imageUrl = await captureTab(tab, area);
	const ogDescription = await inject(tab, readDescription).catch(() => null);
	await savePageWithImage({
		url: tab.url,
		title: tab.title,
		ogDescription,
		imageUrl,
		collectionId,
		taggingMode: overrides.taggingMode
	});
	return 'Page saved with screenshot';
}

async function captureTab(tab, area) {
	const png = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
	const bitmap = await createImageBitmap(await (await fetch(png)).blob());

	// Capture is in device pixels; the selection is in CSS pixels
	const scale = area ? bitmap.width / area.viewportWidth : 1;
	const x = Math.round((area?.x ?? 0) * scale);
	const y = Math.round((area?.y ?? 0) * scale);
	const width = Math.min(Math.round((area?.width ?? Infinity) * scale), bitmap.width - x);
	const height = Math.min(Math.round((area?.height ?? Infinity) * scale), bitmap.height - y);

	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
	const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
	return `data:image/webp;base64,${new Uint8Array(await webp.arrayBuffer()).toBase64()}`;
}

async function inject(tab, func, args = []) {
	const [{ result }] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func,
		args
	});
	return result;
}

async function run(tab, save) {
	try {
		const message = await save();
		if (message) notify(tab, true, message);
	} catch (error) {
		notify(tab, false, error.message);
	}
}

const badgeTimers = new Map();

// Badge on the toolbar icon, plus a toast in the page where scripting is allowed
function notify(tab, ok, message) {
	if (!tab?.id) return;
	const tabId = tab.id;
	chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#2f9e44' : '#e03131' });
	chrome.action.setBadgeText({ tabId, text: ok ? '✓' : '!' });
	clearTimeout(badgeTimers.get(tabId));
	badgeTimers.set(
		tabId,
		setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 3000)
	);
	inject(tab, showToast, [ok, message]).catch(() => {});
}

// The functions below run in the page: self-contained, and shadow-DOM-isolated
// from page styles

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

// Drag-to-select overlay. Resolves to the region in viewport CSS pixels, or
// null on Escape or a click without a drag.
function selectArea() {
	// A toast from an earlier save would end up in the capture
	document.getElementById('re-collect-toast')?.remove();
	return new Promise((resolve) => {
		const dim = 'rgb(0 0 0 / 0.3)';
		const host = document.createElement('div');
		host.id = 're-collect-select';
		const shadow = host.attachShadow({ mode: 'closed' });
		const overlay = document.createElement('div');
		overlay.style.cssText = `position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: ${dim};`;
		const hint = document.createElement('div');
		hint.textContent = 'Drag to select an area · Esc to cancel';
		hint.style.cssText = `
			position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
			padding: 6px 10px; font: 13px/1.4 system-ui, sans-serif;
			color: #e6e6e6; background: #1f1f1f; border: 1px solid #333;
		`;
		const box = document.createElement('div');
		box.style.cssText = `position: fixed; display: none; outline: 1px solid #fff; box-shadow: 0 0 0 100vmax ${dim};`;
		overlay.append(box, hint);
		shadow.append(overlay);
		document.documentElement.append(host);

		let start = null;
		const rectTo = (e) => ({
			x: Math.min(start.x, e.clientX),
			y: Math.min(start.y, e.clientY),
			width: Math.abs(e.clientX - start.x),
			height: Math.abs(e.clientY - start.y)
		});
		const onKey = (e) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			finish(null);
		};
		const finish = (rect) => {
			host.remove();
			removeEventListener('keydown', onKey, true);
			// Let the overlay paint away before the tab is captured
			requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
		};

		addEventListener('keydown', onKey, true);
		overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
		overlay.onpointerdown = (e) => {
			start = { x: e.clientX, y: e.clientY };
			overlay.setPointerCapture(e.pointerId);
			overlay.style.background = 'transparent';
			hint.remove();
			box.style.display = 'block';
		};
		overlay.onpointermove = (e) => {
			if (!start) return;
			const r = rectTo(e);
			Object.assign(box.style, {
				left: `${r.x}px`,
				top: `${r.y}px`,
				width: `${r.width}px`,
				height: `${r.height}px`
			});
		};
		overlay.onpointerup = (e) => {
			const r = rectTo(e);
			finish(r.width < 8 || r.height < 8 ? null : { ...r, viewportWidth: innerWidth });
		};
	});
}

function readDescription() {
	const meta =
		document.querySelector('meta[property="og:description"]') ??
		document.querySelector('meta[name="description"]');
	return meta?.content.trim() || null;
}
