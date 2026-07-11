(function () {
	'use strict';

	const DEFAULT_ICON = 'home';

	function readViewMeta() {
		const root = document.getElementById('app-content');
		if (!root || !root.dataset.acViewMeta) return {};
		try {
			return JSON.parse(root.dataset.acViewMeta);
		} catch (_) {
			return {};
		}
	}

	function setText(id, text) {
		const el = document.getElementById(id);
		if (el) el.textContent = text == null ? '' : String(text);
	}

	function mountHeaderIcon(iconName) {
		const host = document.getElementById('ac-page-header-icon');
		if (!host || !window.AudioCheckIcons) return;
		AudioCheckIcons.mount(host, iconName || DEFAULT_ICON);
		const svg = host.querySelector('.ac-icon');
		if (svg) svg.classList.add('ac-page-header__icon-svg');
	}

	function updateScopeStrip(track, playing) {
		const status = document.getElementById('ac-scope-status');
		const detail = document.getElementById('ac-scope-detail');
		if (!status || !detail) return;
		if (track && playing) {
			status.textContent = t('audiocheck', 'Playing');
			const parts = [track.title || track.fileName || '', track.artist || ''].filter(Boolean);
			detail.textContent = parts.join(' · ') || t('audiocheck', 'Now playing');
			return;
		}
		if (track) {
			status.textContent = t('audiocheck', 'Paused');
			const parts = [track.title || track.fileName || '', track.artist || ''].filter(Boolean);
			detail.textContent = parts.join(' · ') || t('audiocheck', 'Playback paused');
			return;
		}
		status.textContent = t('audiocheck', 'Ready');
		detail.textContent = t('audiocheck', 'Your audio library in Nextcloud');
	}

	function update(viewId, overrides) {
		const meta = readViewMeta();
		const view = Object.assign({}, meta[viewId] || {}, overrides || {});
		const title = view.title || '';
		const help = view.help || '';
		const icon = view.icon || DEFAULT_ICON;

		setText('ac-page-title', title);
		setText('ac-page-lead', help);
		setText('ac-breadcrumb-current', title);
		mountHeaderIcon(icon);

		const appContent = document.getElementById('app-content');
		if (appContent) {
			appContent.dataset.acView = viewId;
			appContent.className = appContent.className.replace(/\bac-app--\S+/g, '').trim();
			appContent.classList.add('ac-app', 'ac-app--' + viewId);
		}
		const main = document.getElementById('ac-main');
		if (main) main.dataset.acView = viewId;

		const lead = document.getElementById('ac-page-lead');
		if (lead) lead.hidden = !help;
	}

	function setActions(nodes) {
		const host = document.getElementById('ac-page-actions');
		if (!host) return;
		host.textContent = '';
		const list = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);
		list.forEach((node) => {
			if (node) host.appendChild(node);
		});
		host.hidden = list.length === 0;
	}

	/**
	 * Primary actions stay visible; secondary actions collapse into a More menu on narrow viewports.
	 * @param {HTMLElement[]} primary
	 * @param {HTMLElement[]} secondary
	 */
	function setActionsGrouped(primary, secondary) {
		const host = document.getElementById('ac-page-actions');
		if (!host) return;
		host.textContent = '';
		const prim = (primary || []).filter(Boolean);
		const sec = (secondary || []).filter(Boolean);
		if (!prim.length && !sec.length) {
			host.hidden = true;
			return;
		}
		if (!sec.length) {
			prim.forEach((node) => host.appendChild(node));
			host.hidden = false;
			return;
		}
		const cluster = document.createElement('div');
		cluster.className = 'ac-page-actions-cluster';
		prim.forEach((node) => cluster.appendChild(node));

		const details = document.createElement('details');
		details.className = 'ac-actions-overflow';
		const moreLabel = t('audiocheck', 'More actions');
		const summary = document.createElement('summary');
		summary.className = 'ac-btn ac-actions-overflow__toggle';
		summary.textContent = moreLabel;
		summary.setAttribute('aria-label', moreLabel);
		details.appendChild(summary);

		const menu = document.createElement('div');
		menu.className = 'ac-actions-overflow__menu';
		menu.setAttribute('role', 'group');
		menu.setAttribute('aria-label', moreLabel);
		const closeOverflow = () => {
			details.open = false;
			summary.focus();
		};
		sec.forEach((node) => {
			menu.appendChild(node);
			node.addEventListener('click', () => {
				closeOverflow();
			});
		});
		details.appendChild(menu);

		let outsideClick = null;
		let escapeKey = null;
		details.addEventListener('toggle', () => {
			if (outsideClick) {
				document.removeEventListener('click', outsideClick, true);
				document.removeEventListener('keydown', escapeKey);
				outsideClick = null;
				escapeKey = null;
			}
			if (!details.open) return;
			outsideClick = (ev) => {
				if (!details.contains(ev.target)) closeOverflow();
			};
			escapeKey = (ev) => {
				if (ev.key === 'Escape') closeOverflow();
			};
			requestAnimationFrame(() => {
				document.addEventListener('click', outsideClick, true);
				document.addEventListener('keydown', escapeKey);
			});
		});
		cluster.appendChild(details);
		host.appendChild(cluster);
		host.hidden = false;
	}

	function clearActions() {
		setActions([]);
	}

	function bindPlayerScope() {
		if (!window.AudioCheckPlayer || typeof AudioCheckPlayer.subscribe !== 'function') return;
		const sync = () => {
			const track = AudioCheckPlayer.getCurrentTrack ? AudioCheckPlayer.getCurrentTrack() : null;
			const audio = document.getElementById('ac-audio');
			const playing = !!(audio && !audio.paused && !audio.ended);
			updateScopeStrip(track, playing);
		};
		AudioCheckPlayer.subscribe(sync);
		sync();
	}

	window.AudioCheckPageChrome = {
		update,
		setActions,
		setActionsGrouped,
		clearActions,
		updateScopeStrip,
		bindPlayerScope,
	};
})();
