// The app's stand-in for window.alert, and its toasts: notify(...) shows a short
// message in the Notices stack the (app) layout renders once. A notice never takes
// focus, and goes after a few seconds or on a click.

interface Notice {
	id: number;
	text: string;
	error: boolean;
	// A link after the text, e.g. to the item just added
	link?: { href: string; label: string };
}

interface NoticeOptions {
	error?: boolean;
	link?: Notice['link'];
	// How long it shows, in ms
	duration?: number;
	// An earlier notice this one takes over from, e.g. 'adding...' becoming 'added'
	replaces?: number;
}

const MAX_SHOWN = 3;

export const notices = $state<Notice[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 0;

// Returns the notice's id, for replacing or dismissing it early
export function notify(
	text: string,
	{ error = false, link, duration = error ? 8000 : 5000, replaces }: NoticeOptions = {}
) {
	if (replaces !== undefined) dismiss(replaces);
	// A burst of the same failure shows once, for as long as the last one would
	let notice = link
		? undefined
		: notices.find((n) => !n.link && n.text === text && n.error === error);
	if (!notice) {
		notice = { id: nextId++, text, error, link };
		notices.push(notice);
		if (notices.length > MAX_SHOWN) dismiss(notices[0].id);
	}
	const { id } = notice;
	clearTimeout(timers.get(id));
	timers.set(
		id,
		setTimeout(() => dismiss(id), duration)
	);
	return id;
}

export function dismiss(id: number) {
	clearTimeout(timers.get(id));
	timers.delete(id);
	const index = notices.findIndex((n) => n.id === id);
	if (index !== -1) notices.splice(index, 1);
}
