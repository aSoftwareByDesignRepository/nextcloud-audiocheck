(function () {
	'use strict';

	const FALLBACK_ID = 'ac-toast-fallback';
	let fallbackTimer = 0;

	function showFallbackToast(message, type) {
		const el = document.getElementById(FALLBACK_ID);
		if (!el) return;
		const kind = type || 'info';
		el.hidden = false;
		el.className = 'ac-toast-fallback ac-toast-fallback--' + kind;
		el.textContent = message;
		window.clearTimeout(fallbackTimer);
		fallbackTimer = window.setTimeout(() => {
			el.hidden = true;
			el.textContent = '';
		}, 6000);
	}

	window.AudioCheckMessaging = {
		toast(message, type) {
			const text = message == null ? '' : String(message);
			if (!text) return;
			if (window.OC && OC.Notification && OC.Notification.showTemporary) {
				OC.Notification.showTemporary(text, { type: type || 'info' });
				return;
			}
			showFallbackToast(text, type);
		},
		escape(text) {
			const d = document.createElement('div');
			d.textContent = text == null ? '' : String(text);
			return d.innerHTML;
		},
	};
})();
