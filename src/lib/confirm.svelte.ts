// The app's stand-in for window.confirm: `await confirmAction(...)` opens the
// ConfirmDialog the (app) layout renders and resolves true once confirmed.

export interface ConfirmRequest {
	title: string;
	message?: string;
	// The confirm button's label, e.g. 'delete'
	action: string;
	// Styles the confirm button as destructive
	danger?: boolean;
}

export const confirmation = $state<{
	request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}>({ request: null });

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
	// A second request settles the first as cancelled
	confirmation.request?.resolve(false);
	return new Promise((resolve) => {
		confirmation.request = { ...request, resolve };
	});
}

export function settleConfirmation(ok: boolean) {
	confirmation.request?.resolve(ok);
	confirmation.request = null;
}
