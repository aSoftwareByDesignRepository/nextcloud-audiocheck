(function () {
	'use strict';

	const DEBOUNCE_MS = 350;
	const SEARCH_VIEWS = new Set(['home', 'browse', 'music', 'audiobooks', 'playlists']);
	const listeners = new Set();

	let query = '';
	let debouncedQuery = '';
	let debounceTimer = null;

	function currentViewId() {
		if (window.AudioCheckRouter && typeof AudioCheckRouter.getCurrentView === 'function') {
			const active = AudioCheckRouter.getCurrentView();
			if (active) return active;
		}
		return document.getElementById('ac-main')?.dataset?.acView
			|| document.getElementById('app-content')?.dataset?.acView
			|| 'home';
	}

	function notify(immediate) {
		listeners.forEach((fn) => {
			try { fn({ query, debouncedQuery, immediate: !!immediate }); } catch (_) { /* ignore */ }
		});
		if (!immediate) {
			const currentView = currentViewId();
			if (currentView && viewHandlers.has(currentView)) {
				try { viewHandlers.get(currentView)({ query, debouncedQuery }); } catch (_) { /* ignore */ }
			}
		}
	}

	const viewHandlers = new Map();

	function scheduleDebounce() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = query;
			notify(false);
		}, DEBOUNCE_MS);
	}

	function normalizeSearchText(value) {
		if (!value) return '';
		return String(value)
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/ß/g, 'ss')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();
	}

	function tokenizeQuery(q) {
		const normalized = normalizeSearchText(q);
		if (!normalized) return [];
		return Array.from(new Set(normalized.split(' ').filter(Boolean)));
	}

	function matchesSearchQuery(fields, q) {
		const tokens = tokenizeQuery(q);
		if (!tokens.length) return true;
		const haystack = (fields || []).map((f) => normalizeSearchText(f)).filter(Boolean).join(' ');
		if (!haystack) return false;
		return tokens.every((token) => haystack.includes(token));
	}

	function apiQueryParam(q) {
		const trimmed = (q || '').trim();
		return trimmed.length >= 2 ? trimmed : '';
	}

	window.AudioCheckGlobalSearch = {
		DEBOUNCE_MS,
		SEARCH_VIEWS,
		getQuery() { return query; },
		getDebouncedQuery() { return debouncedQuery; },
		setQuery(next) {
			query = String(next || '');
			scheduleDebounce();
			notify(true);
		},
		clear() {
			clearTimeout(debounceTimer);
			debounceTimer = null;
			query = '';
			debouncedQuery = '';
			notify(false);
		},
		registerViewHandler(viewId, handler) {
			viewHandlers.set(viewId, handler);
			return () => viewHandlers.delete(viewId);
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		isActiveView(viewId) {
			return SEARCH_VIEWS.has(viewId);
		},
		normalizeSearchText,
		matchesSearchQuery,
		apiQueryParam,
	};
})();
