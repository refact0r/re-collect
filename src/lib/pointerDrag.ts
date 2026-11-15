// Pointer drag for reorderable grids. A mouse or pen drags the whole card once it
// moves a few pixels, so a plain click still opens it; touch never drags, so swipes
// scroll and long presses keep the browser's own menu. While
// dragging, the nearest scroll container auto-scrolls near its edges, Escape
// cancels, and the click that ends the drag is swallowed.

const MOVE_THRESHOLD = 5;
const EDGE = 64;
const MAX_SCROLL_SPEED = 20;

interface DragCallbacks {
	/** The drag begins; (x, y) is where the pointer went down */
	start: (x: number, y: number) => void;
	/** The pointer moved, or the container scrolled under it */
	move: (x: number, y: number) => void;
	/** Dropped (commit) or cancelled */
	end: (commit: boolean) => void;
}

/** Call from a draggable element's pointerdown; returns a function that cancels the drag */
export function pointerDrag(e: PointerEvent, { start, move, end }: DragCallbacks): () => void {
	const target = e.target as Element;
	if (
		e.pointerType === 'touch' ||
		!e.isPrimary ||
		e.button !== 0 ||
		e.ctrlKey ||
		e.metaKey ||
		e.shiftKey ||
		e.altKey ||
		target.closest('button, input, textarea, select')
	) {
		return () => {};
	}
	// No text selection or native link/image drag
	e.preventDefault();

	const origin = { x: e.clientX, y: e.clientY };
	let pointer = origin;
	let dragging = false;
	let autoScrollArmed = false;
	let frame = 0;
	const scroller = scrollParent(e.currentTarget as Element);
	const listeners = new AbortController();
	const { signal } = listeners;

	function begin() {
		dragging = true;
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
		// Scroll events don't bubble; capturing on document sees the scroller's
		document.addEventListener('scroll', () => move(pointer.x, pointer.y), {
			capture: true,
			passive: true,
			signal
		});
		window.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
		start(origin.x, origin.y);
		move(pointer.x, pointer.y);
		frame = requestAnimationFrame(autoScroll);
	}

	// Scrolls faster the closer the pointer is to (or the further past) the edge. Armed
	// only once the pointer has moved away from where it went down, so pressing a card
	// that already sits near an edge doesn't scroll the page on its own.
	function autoScroll() {
		autoScrollArmed ||= Math.hypot(pointer.x - origin.x, pointer.y - origin.y) > EDGE / 2;
		if (autoScrollArmed) {
			const rect = scroller.getBoundingClientRect();
			const top = Math.max(rect.top, 0);
			const bottom = Math.min(rect.bottom, innerHeight);
			if (pointer.y < top + EDGE) scroller.scrollTop -= scrollSpeed(pointer.y - top);
			else if (pointer.y > bottom - EDGE) scroller.scrollTop += scrollSpeed(bottom - pointer.y);
		}
		frame = requestAnimationFrame(autoScroll);
	}

	function finish(commit: boolean) {
		listeners.abort();
		if (!dragging) return;
		dragging = false;
		cancelAnimationFrame(frame);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		swallowNextClick();
		end(commit);
	}

	const ours = (ev: PointerEvent) => ev.pointerId === e.pointerId;
	document.addEventListener(
		'pointermove',
		(ev) => {
			if (!ours(ev)) return;
			pointer = { x: ev.clientX, y: ev.clientY };
			if (dragging) move(pointer.x, pointer.y);
			else if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) >= MOVE_THRESHOLD) begin();
		},
		{ signal }
	);
	document.addEventListener('pointerup', (ev) => ours(ev) && finish(true), { signal });
	document.addEventListener('pointercancel', (ev) => ours(ev) && finish(false), { signal });
	window.addEventListener('keydown', (ev) => ev.key === 'Escape' && finish(false), { signal });

	return () => finish(false);
}

// Pixels per frame for a pointer this far inside the edge zone (negative: past the edge)
function scrollSpeed(distance: number) {
	return Math.ceil(MAX_SCROLL_SPEED * Math.min(1, 1 - distance / EDGE));
}

function scrollParent(el: Element | null): Element {
	for (; el; el = el.parentElement) {
		if (/auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
			return el;
		}
	}
	return document.scrollingElement ?? document.documentElement;
}

// The click that follows a drag's pointerup would open the card; it fires in the
// same task, so a listener that lapses on the next tick catches only that one
function swallowNextClick() {
	const swallow = (ev: Event) => {
		ev.preventDefault();
		ev.stopPropagation();
	};
	window.addEventListener('click', swallow, { capture: true, once: true });
	setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
}
