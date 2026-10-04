(function () {
	'use strict';

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
		// Always render the app-owned toast: delegating to OC.Notification
		// (toastify) bypasses kind+text dedup AND produces a .toastify node the
		// shared app-feedback hook can never match — error toasts would lose
		// their "Report this problem" link (dead-hook class, cf. ticketcheck).
		announce(text, kind === 'error' ? 'error' : (kind === 'warning' ? 'warning' : 'success'));
		const container = ensureToastContainer();
		const ttl = kind === 'error' ? 7000 : 4500;
		const key = kind + ':' + text;
		const existing = Array.from(container.children).find((node) => node.dataset && node.dataset.toastKey === key);
		if (existing) {
			window.clearTimeout(Number(existing.dataset.toastTimer || 0));
			existing.dataset.toastTimer = String(window.setTimeout(() => {
				if (existing.parentNode) existing.parentNode.removeChild(existing);
			}, ttl));
			return;
		}
		const toast = document.createElement('div');
		toast.className = 'ac-toast ac-toast--' + kind;
		toast.dataset.toastKey = kind + ':' + text;
		toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
		const label = document.createElement('span');
		label.className = 'ac-toast__text';
		label.textContent = text;
		toast.appendChild(label);
		// Report-this-problem self-attach: the shared app-feedback wrapper only
		// covers {App}Components.showToast/showError, which this app never calls
		// (it exposes AudioCheckMessaging.toast) — error toasts get the family
		// mailto link inline here (canonical fix: ticketcheck/mobilitycheck).
		if (kind === 'error' && window.SbdAppFeedback && typeof window.SbdAppFeedback.buildMailto === 'function') {
			try {
				const report = document.createElement('a');
				report.className = 'ac-nav-footer__toast-link ac-toast__report';
				report.href = window.SbdAppFeedback.buildMailto('problem');
				report.textContent = t('audiocheck', 'Report this problem');
				toast.appendChild(report);
			} catch (_) { /* mailto is best-effort */ }
		}
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'ac-toast__close';
		close.setAttribute('aria-label', t('audiocheck', 'Dismiss'));
		close.textContent = '×';
		close.addEventListener('click', () => toast.remove());
		toast.appendChild(close);
		container.appendChild(toast);
		toast.dataset.toastTimer = String(window.setTimeout(() => {
			if (toast.parentNode) toast.parentNode.removeChild(toast);
		}, ttl));
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
