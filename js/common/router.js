(function () {
	'use strict';

	const routes = {
		home: { path: '/', view: 'home' },
		audiobooks: { path: '/audiobooks', view: 'audiobooks' },
		music: { path: '/music', view: 'music' },
		playlists: { path: '/playlists', view: 'playlists' },
		playlist: { path: /^\/playlists\/(\d+)/, view: 'playlist' },
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
				if (m) return { id, view: r.view, params: { playlistId: parseInt(m[1], 10) } };
			} else if (rel === r.path || rel === r.path + '/') {
				return { id, view: r.view, params: {} };
			}
		}
		return { id: 'home', view: 'home', params: {} };
	}

	function navigate(viewId, params, push) {
		const r = Object.entries(routes).find(([, v]) => v.view === viewId);
		let path = appBase() + (r ? (typeof r[1].path === 'string' ? r[1].path : '/playlists/' + (params.playlistId || '')) : '/');
		if (push !== false) history.pushState({ view: viewId, params }, '', path);
		render(viewId, params || {});
	}

	function render(viewId, params) {
		if (!root) return;
		currentView = viewId;
		root.dataset.acView = viewId;
		root.textContent = '';
		const view = views[viewId];
		if (view && typeof view.render === 'function') {
			root.appendChild(view.render(params));
		}
		document.querySelectorAll('.ac-nav__link').forEach((a) => {
			const href = a.getAttribute('href') || '';
			a.classList.toggle('ac-nav__link--active', href.endsWith(routes[viewId]?.path) || (viewId === 'playlist' && href.includes('/playlists')));
			a.toggleAttribute('aria-current', a.classList.contains('ac-nav__link--active') ? 'page' : false);
		});
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
			if (root.dataset.acPlaylistId) params.playlistId = parseInt(root.dataset.acPlaylistId, 10);
			render(initial, params);
		},
		navigate,
		getCurrentView() { return currentView; },
	};
})();
