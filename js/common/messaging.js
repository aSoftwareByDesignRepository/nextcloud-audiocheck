(function () {
	'use strict';

	const FALLBACK_ID = 'ac-toast-fallback';

	function politeRegion() {
		return document.getElementById('ac-live-region') || document.getElementById('ac-announcer');
	}

	function assertiveRegion() {
		return document.getElementById('ac-alert-region') || document.getElementById('ac-announcer');
	}

	function ensureToastContainer() {
		let container = document.getElementById('ac-toasts');
		if (!container) {
			container = document.createElement('div');
			container.id = 'ac-toasts';
			container.className = 'ac-toasts';
			container.setAttribute('aria-live', 'polite');
			document.body.appendChild(container);
		}
		return container;
	}

	function announce(message, kind) {
		const text = message == null ? '' : String(message);
		if (!text) return;
		const k = kind === 'error' ? 'error' : (kind === 'warning' ? 'warning' : 'success');
		const target = (k === 'error' ? assertiveRegion() : politeRegion());
		if (target) {
			target.textContent = '';
			window.setTimeout(() => { target.textContent = text; }, 10);
		}
	}

	function showToast(message, type) {
		const text = message == null ? '' : String(message);
		if (!text) return;
		const kind = type || 'info';
		if (window.OC && OC.Notification && OC.Notification.showTemporary) {
			OC.Notification.showTemporary(text, { type: kind });
			return;
		}
		announce(text, kind === 'error' ? 'error' : (kind === 'warning' ? 'warning' : 'success'));
		const container = ensureToastContainer();
		const toast = document.createElement('div');
		toast.className = 'ac-toast ac-toast--' + kind;
		toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
		const label = document.createElement('span');
		label.textContent = text;
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'ac-toast__close';
		close.setAttribute('aria-label', t('audiocheck', 'Dismiss'));
		close.textContent = '×';
		close.addEventListener('click', () => toast.remove());
		toast.appendChild(label);
		toast.appendChild(close);
		container.appendChild(toast);
		window.setTimeout(() => {
			if (toast.parentNode) toast.parentNode.removeChild(toast);
		}, kind === 'error' ? 7000 : 4500);
	}

	window.AudioCheckMessaging = {
		toast: showToast,
		announce,
		escape(text) {
			const d = document.createElement('div');
			d.textContent = text == null ? '' : String(text);
			return d.innerHTML;
		},
	};
})();
