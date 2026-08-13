(function () {
	'use strict';

	const SETTINGS_SECTION_RE = 'access|admins|defaults|support';
	const DEFAULT_SETTINGS_SECTION = 'access';

	const routes = {
		home: { path: '/', view: 'home' },
		audiobooks: { path: '/audiobooks', view: 'audiobooks' },
		music: { path: '/music', view: 'music' },
		playlists: { path: '/playlists', view: 'playlists' },
		playlist: { path: /^\/playlists\/(\d+|favorites)$/, view: 'playlist' },
		browse: { path: '/browse', view: 'browse' },
		'now-playing': { path: '/now-playing', view: 'now-playing' },
		library: { path: '/library', view: 'library' },
		settings: { path: '/settings', view: 'settings' },
		'get-the-app': { path: '/get-the-app', view: 'get-the-app' },
		'app-settings': { path: new RegExp('^/app-settings(?:/(' + SETTINGS_SECTION_RE + '))?/?$'), view: 'app-settings' },
	};

	const views = {};
	let root = null;
	let currentView = null;

	function appBase() {
		return OC.generateUrl('/apps/audiocheck');
	}

	function normalizeSettingsSection(raw) {
		const section = String(raw || '').toLowerCase();
		return new RegExp('^(' + SETTINGS_SECTION_RE + ')$').test(section) ? section : DEFAULT_SETTINGS_SECTION;
	}

	function matchRoute(pathname) {
		const rel = pathname.replace(appBase(), '') || '/';
		for (const [id, r] of Object.entries(routes)) {
			if (r.path instanceof RegExp) {
				const m = rel.match(r.path);
				if (m) {
					if (r.view === 'playlist') {
						const raw = m[1];
						const playlistId = raw === AudioCheckConstants.FAVORITES_PLAYLIST_ID
							? AudioCheckConstants.FAVORITES_PLAYLIST_ID
							: parseInt(raw, 10);
						return { id, view: r.view, params: { playlistId } };
					}
					if (r.view === 'app-settings') {
						return {
							id,
							view: r.view,
							params: { settingsSection: normalizeSettingsSection(m[1] || DEFAULT_SETTINGS_SECTION) },
						};
					}
				}
			} else if (rel === r.path || rel === r.path + '/') {
				return { id, view: r.view, params: {} };
			}
		}
		return { id: 'home', view: 'home', params: {} };
	}

	function pathFor(viewId, params) {
		params = params || {};
		if (viewId === 'app-settings') {
			return appBase() + '/app-settings/' + normalizeSettingsSection(params.settingsSection);
		}
		if (viewId === 'playlist') {
			return appBase() + '/playlists/' + (params.playlistId ?? '');
		}
		const entry = Object.entries(routes).find(([, v]) => v.view === viewId && typeof v.path === 'string');
		return appBase() + (entry ? entry[1].path : '/');
	}

	function navigate(viewId, params, push) {
		if (window.AudioCheckMobileNav && typeof AudioCheckMobileNav.close === 'function') {
			AudioCheckMobileNav.close();
		}
		const nextParams = params || {};
		const path = pathFor(viewId, nextParams);
		if (push !== false) history.pushState({ view: viewId, params: nextParams }, '', path);
		render(viewId, nextParams);
	}

	const LIBRARY_BROWSE_VIEWS = new Set(['music', 'audiobooks', 'playlists', 'browse', 'playlist']);

	function updateMainLayout(viewId) {
		const shell = document.getElementById('app-content-wrapper');
		if (!shell) return;
		shell.classList.toggle('ac-shell--library-browse', LIBRARY_BROWSE_VIEWS.has(viewId));
	}

	/**
	 * App-settings subnav expands only while that view is active (SETTINGS-PAGES-STANDARD).
	 * Always sync class + aria-expanded + hidden together so CSS/a11y cannot drift.
	 */
	function syncAppSettingsNavExpansion(parentLi, expanded) {
		if (!parentLi) return false;
		const open = !!expanded;
		const link = parentLi.querySelector(':scope > .ac-nav__link');
		parentLi.classList.toggle('is-expanded', open);
		if (link) {
			link.setAttribute('aria-expanded', open ? 'true' : 'false');
		}
		const kids = parentLi.querySelector(':scope > .ac-nav__children');
		if (kids) {
			kids.hidden = !open;
		}
		return open;
	}

	function updateNavActive(viewId, params) {
		const section = viewId === 'app-settings'
			? normalizeSettingsSection(params && params.settingsSection)
			: '';
		document.querySelectorAll('.ac-nav__item').forEach((li) => {
			const navId = li.getAttribute('data-ac-nav-id') || '';
			const link = li.querySelector(':scope > .ac-nav__link');
			if (!link) return;
			let active = navId === viewId;
			if (viewId === 'playlist' && navId === 'playlists') active = true;
			if (viewId === 'app-settings' && navId === 'app-settings') active = true;
			if (viewId === 'app-settings' && navId === 'app-settings-' + section) active = true;
			link.classList.toggle('ac-nav__link--active', active);
			link.classList.toggle('is-active', active);
			link.classList.toggle('active', active);
			const isChild = li.classList.contains('ac-nav__item--child');
			if (active && (isChild || navId !== 'app-settings')) {
				link.setAttribute('aria-current', 'page');
			} else {
				link.removeAttribute('aria-current');
			}
			if (navId === 'app-settings') {
				syncAppSettingsNavExpansion(li, viewId === 'app-settings');
			}
		});
	}

	function render(viewId, params) {
		if (!root) return;
		params = params || {};
		currentView = viewId;
		root.dataset.acView = viewId;
		if (viewId === 'app-settings') {
			root.dataset.acSettingsSection = normalizeSettingsSection(params.settingsSection);
		} else {
			delete root.dataset.acSettingsSection;
		}
		const appContent = document.getElementById('app-content');
		if (appContent) {
			appContent.dataset.acView = viewId;
			Array.from(appContent.classList).forEach((cls) => {
				if (cls.indexOf('ac-app--') === 0) appContent.classList.remove(cls);
			});
			appContent.classList.add('ac-app--' + viewId);
		}
		updateMainLayout(viewId);
		if (window.AudioCheckPageChrome) {
			AudioCheckPageChrome.clearActions();
			const chromeOverrides = Object.assign({}, params.pageChrome || {});
			if (viewId === 'app-settings') {
				const section = normalizeSettingsSection(params.settingsSection);
				const meta = (function () {
					try {
						return JSON.parse(appContent?.dataset?.acViewMeta || '{}');
					} catch (_) {
						return {};
					}
				}());
				const sectionMeta = meta['app-settings:' + section] || {};
				if (sectionMeta.title) chromeOverrides.title = sectionMeta.title;
				if (sectionMeta.help) chromeOverrides.help = sectionMeta.help;
				if (sectionMeta.icon) chromeOverrides.icon = sectionMeta.icon;
			}
			AudioCheckPageChrome.update(viewId, chromeOverrides);
		}
		root.textContent = '';
		const view = views[viewId];
		if (view && typeof view.render === 'function') {
			root.appendChild(view.render(params));
		}
		updateNavActive(viewId, params);
		document.dispatchEvent(new CustomEvent('audiocheck-view-change', {
			bubbles: true,
			detail: { viewId, params },
		}));
	}

	window.AudioCheckRouter = {
		register(viewId, handlers) { views[viewId] = handlers; },
		/** @internal exported for unit / mutation tests */
		syncAppSettingsNavExpansion,
		init(container) {
			root = container;
			window.addEventListener('popstate', () => {
				const m = matchRoute(location.pathname);
				render(m.view, m.params);
			});
			document.querySelectorAll('.ac-nav__link').forEach((link) => {
				link.addEventListener('click', (e) => {
					const href = link.getAttribute('href');
					if (!href || e.metaKey || e.ctrlKey) return;
					e.preventDefault();
					const m = matchRoute(href);
					navigate(m.view, m.params);
				});
			});
			const m = matchRoute(location.pathname);
			const initial = document.getElementById('app-content')?.dataset?.acView || m.view;
			const params = Object.assign({}, m.params);
			if (root.dataset.acPlaylistId) {
				const raw = root.dataset.acPlaylistId;
				params.playlistId = raw === AudioCheckConstants.FAVORITES_PLAYLIST_ID
					? AudioCheckConstants.FAVORITES_PLAYLIST_ID
					: parseInt(raw, 10);
			}
			if (root.dataset.acSettingsSection) {
				params.settingsSection = normalizeSettingsSection(root.dataset.acSettingsSection);
			}
			render(initial, params);
		},
		navigate,
		getCurrentView() { return currentView; },
		normalizeSettingsSection,
	};
})();
