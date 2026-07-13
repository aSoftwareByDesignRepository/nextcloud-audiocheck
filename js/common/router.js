(function () {
	'use strict';

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
		'app-settings': { path: '/app-settings', view: 'app-settings' },
	};

	const views = {};
	let root = null;
	let currentView = null;

	function appBase() {
		return OC.generateUrl('/apps/audiocheck');
	}

	function matchRoute(pathname) {
		const rel = pathname.replace(appBase(), '') || '/';
		for (const [id, r] of Object.entries(routes)) {
			if (r.path instanceof RegExp) {
				const m = rel.match(r.path);
				if (m) {
					const raw = m[1];
					const playlistId = raw === AudioCheckConstants.FAVORITES_PLAYLIST_ID
						? AudioCheckConstants.FAVORITES_PLAYLIST_ID
						: parseInt(raw, 10);
					return { id, view: r.view, params: { playlistId } };
				}
			} else if (rel === r.path || rel === r.path + '/') {
				return { id, view: r.view, params: {} };
			}
		}
		return { id: 'home', view: 'home', params: {} };
	}

	function navigate(viewId, params, push) {
		if (window.AudioCheckMobileNav && typeof AudioCheckMobileNav.close === 'function') {
			AudioCheckMobileNav.close();
		}
		const r = Object.entries(routes).find(([, v]) => v.view === viewId);
		let path = appBase() + (r ? (typeof r[1].path === 'string' ? r[1].path : '/playlists/' + (params.playlistId ?? '')) : '/');
		if (push !== false) history.pushState({ view: viewId, params }, '', path);
		render(viewId, params || {});
	}

	const LIBRARY_BROWSE_VIEWS = new Set(['music', 'audiobooks', 'playlists', 'browse', 'playlist']);

	function updateMainLayout(viewId) {
		const shell = document.getElementById('app-content-wrapper');
		if (!shell) return;
		shell.classList.toggle('ac-shell--library-browse', LIBRARY_BROWSE_VIEWS.has(viewId));
	}

	function render(viewId, params) {
		if (!root) return;
		currentView = viewId;
		root.dataset.acView = viewId;
		const appContent = document.getElementById('app-content');
		if (appContent) appContent.dataset.acView = viewId;
		updateMainLayout(viewId);
		if (window.AudioCheckPageChrome) {
			AudioCheckPageChrome.clearActions();
			AudioCheckPageChrome.update(viewId, params.pageChrome || null);
		}
		root.textContent = '';
		const view = views[viewId];
		if (view && typeof view.render === 'function') {
			root.appendChild(view.render(params));
		}
		document.querySelectorAll('.ac-nav__link').forEach((a) => {
			const li = a.closest('[data-ac-nav-id]');
			const navId = li ? li.getAttribute('data-ac-nav-id') : '';
			let active = navId === viewId;
			if (viewId === 'playlist' && navId === 'playlists') active = true;
			a.classList.toggle('ac-nav__link--active', active);
			a.classList.toggle('is-active', active);
			a.classList.toggle('active', active);
			a.toggleAttribute('aria-current', active ? 'page' : false);
		});
		document.dispatchEvent(new CustomEvent('audiocheck-view-change', {
			bubbles: true,
			detail: { viewId },
		}));
	}

	window.AudioCheckRouter = {
		register(viewId, handlers) { views[viewId] = handlers; },
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
			const params = {};
			if (root.dataset.acPlaylistId) {
				const raw = root.dataset.acPlaylistId;
				params.playlistId = raw === AudioCheckConstants.FAVORITES_PLAYLIST_ID
					? AudioCheckConstants.FAVORITES_PLAYLIST_ID
					: parseInt(raw, 10);
			}
			render(initial, params);
		},
		navigate,
		getCurrentView() { return currentView; },
	};
})();
