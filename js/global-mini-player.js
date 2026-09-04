(function () {
	'use strict';

	/**
	 * Global mini-player boot for non-AudioCheck pages (Files, Dashboard, …).
	 *
	 * Design rules:
	 * - Idle users pay for one small boot script + CSS only.
	 * - Full player stack loads only when server/session hints say restore may succeed.
	 * - InitialState must use loadState() (NC API); DOM base64 is the hard fallback.
	 * - Prefs must load BEFORE restore (resumeOnOpen / volume / speed).
	 */
	const SESSION_KEY = 'audiocheck_playback_session';
	const BOOT_FLAG = '__acGlobalMiniPlayerBooted';
	const PLAYER_SCRIPTS = [
		'common/constants',
		'common/messaging',
		'common/time',
		'common/api',
		'common/icons',
		'common/components',
		'common/queue-playback-mode',
		'common/queue-merge',
		'common/seek-jump',
		'common/sleep-timer',
		'common/player',
	];

	function loadState() {
		try {
			if (typeof OCP !== 'undefined' && OCP.InitialState && typeof OCP.InitialState.loadState === 'function') {
				return OCP.InitialState.loadState('audiocheck', 'global-mini-player');
			}
			// Older NC builds exposed OC.initialState.loadState (same signature).
			if (typeof OC !== 'undefined' && OC.initialState && typeof OC.initialState.loadState === 'function') {
				return OC.initialState.loadState('audiocheck', 'global-mini-player');
			}
			// Mis-documented alias — keep as last API attempt before DOM.
			if (typeof OCP !== 'undefined' && OCP.InitialState && typeof OCP.InitialState.load === 'function') {
				return OCP.InitialState.load('audiocheck', 'global-mini-player');
			}
		} catch (e) {
			// Missing key throws in @nextcloud/initial-state — fall through to DOM.
		}
		return loadStateFromDom();
	}

	/**
	 * Decode the hidden input Nextcloud embeds for provideInitialState().
	 * Uses UTF-8-safe base64 decode so translated markup never corrupts JSON.parse.
	 */
	function loadStateFromDom() {
		try {
			const el = document.getElementById('initial-state-audiocheck-global-mini-player');
			if (!el || !el.value) return null;
			const json = decodeBase64Utf8(el.value);
			if (!json) return null;
			return JSON.parse(json);
		} catch (e) {
			return null;
		}
	}

	function decodeBase64Utf8(b64) {
		if (typeof atob !== 'function') return null;
		const bin = atob(b64);
		if (typeof TextDecoder === 'function') {
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) {
				bytes[i] = bin.charCodeAt(i);
			}
			return new TextDecoder('utf-8').decode(bytes);
		}
		// Legacy path: escape/decodeURIComponent recovers UTF-8 from binary string.
		try {
			return decodeURIComponent(Array.prototype.map.call(bin, (c) => {
				const h = c.charCodeAt(0).toString(16);
				return '%' + (h.length < 2 ? '0' : '') + h;
			}).join(''));
		} catch (e) {
			return bin;
		}
	}

	function hasSessionHint() {
		try {
			const raw = sessionStorage.getItem(SESSION_KEY);
			if (!raw) return false;
			const snap = JSON.parse(raw);
			return !!(snap && Array.isArray(snap.queue) && snap.queue.length);
		} catch (e) {
			return false;
		}
	}

	function bootScriptVersion(state) {
		if (state && state.assetVersion) return String(state.assetVersion);
		const boot = document.querySelector('script[src*="global-mini-player"]');
		if (boot && boot.src) {
			try {
				const u = new URL(boot.src, window.location.origin);
				const v = u.searchParams.get('v');
				if (v) return v;
			} catch (e) {
				const m = String(boot.src).match(/[?&]v=([^&]+)/);
				if (m) return decodeURIComponent(m[1]);
			}
		}
		return '';
	}

	function scriptSrc(name, version) {
		let base;
		if (typeof OC !== 'undefined' && typeof OC.filePath === 'function') {
			base = OC.filePath('audiocheck', 'js', name + '.js');
		} else {
			base = '/apps/audiocheck/js/' + name + '.js';
		}
		if (!version) return base;
		const join = base.indexOf('?') >= 0 ? '&' : '?';
		return base + join + 'v=' + encodeURIComponent(version);
	}

	function loadScript(name, version) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector('script[data-ac-global-dep="' + name + '"]');
			if (existing) {
				if (existing.dataset.acLoaded === '1') {
					resolve();
					return;
				}
				existing.addEventListener('load', () => resolve());
				existing.addEventListener('error', () => reject(new Error(name)));
				return;
			}
			const s = document.createElement('script');
			s.src = scriptSrc(name, version);
			s.async = false;
			s.dataset.acGlobalDep = name;
			s.addEventListener('load', () => {
				s.dataset.acLoaded = '1';
				resolve();
			});
			s.addEventListener('error', () => reject(new Error('Failed to load ' + name)));
			document.head.appendChild(s);
		});
	}

	function loadPlayerStack(version) {
		let chain = Promise.resolve();
		PLAYER_SCRIPTS.forEach((name) => {
			chain = chain.then(() => loadScript(name, version));
		});
		return chain;
	}

	function mountMarkup(markup) {
		if (!markup) return document.getElementById('ac-mini-player');
		if (document.getElementById('ac-mini-player')) {
			return document.getElementById('ac-mini-player');
		}
		const host = document.createElement('div');
		host.id = 'ac-global-mini-player-root';
		host.setAttribute('data-ac-global-root', '1');
		// Trusted server template (l10n + IconCatalog only). Never pass user content here.
		host.innerHTML = markup;
		document.body.appendChild(host);
		return document.getElementById('ac-mini-player');
	}

	function syncVisibility(state) {
		const player = document.getElementById('ac-mini-player');
		if (!player || !player.classList.contains('ac-mini-player--global')) return;
		const track = window.AudioCheckPlayer && typeof AudioCheckPlayer.getCurrentTrack === 'function'
			? AudioCheckPlayer.getCurrentTrack()
			: null;
		const restoring = window.AudioCheckPlayer && typeof AudioCheckPlayer.isRestoring === 'function'
			? AudioCheckPlayer.isRestoring()
			: !!document.documentElement.dataset.acGlobalPending;
		const expectRestore = !!(state && state.hasServerPlayback) || hasSessionHint();
		// Show while bootstrap / pending restore runs, or once a track is loaded.
		const visible = !!(track || (expectRestore && restoring));
		player.hidden = !visible;
		player.setAttribute('aria-hidden', visible ? 'false' : 'true');
		if ('inert' in HTMLElement.prototype) {
			player.inert = !visible;
		}
		document.body.classList.toggle('ac-global-mini-player-visible', visible);
		if (window.AudioCheckPlayer && typeof AudioCheckPlayer.syncPlayerClearance === 'function') {
			AudioCheckPlayer.syncPlayerClearance();
		} else if (visible) {
			document.documentElement.style.setProperty('--ac-player-clearance', player.offsetHeight + 'px');
		} else {
			document.documentElement.style.setProperty('--ac-player-clearance', '0px');
		}
	}

	function fetchPrefs() {
		if (window.AudioCheckApi && typeof AudioCheckApi.get === 'function') {
			return AudioCheckApi.get('/apps/audiocheck/api/prefs').catch(() => ({}));
		}
		return Promise.resolve({});
	}

	function applyPrefs(prefs) {
		window.AudioCheckUserPrefs = prefs || {};
		if (prefs && typeof prefs.defaultVolume === 'number' && window.AudioCheckPlayer
			&& typeof AudioCheckPlayer.setVolumePercent === 'function') {
			AudioCheckPlayer.setVolumePercent(prefs.defaultVolume, { persist: false });
		}
	}

	function startPlayer(state) {
		document.body.classList.add('ac-global-mini-player-host');
		document.documentElement.dataset.acPlayerMode = 'global';
		window.AudioCheckGlobalPlayer = {
			nowPlayingUrl: state.nowPlayingUrl || '',
			isGlobal: true,
			hasServerPlayback: !!state.hasServerPlayback,
		};

		mountMarkup(state.markup);

		if (!window.AudioCheckPlayer) {
			console.error('[audiocheck] global mini-player: AudioCheckPlayer missing');
			delete document.documentElement.dataset.acGlobalPending;
			syncVisibility(state);
			return;
		}

		if (typeof AudioCheckPlayer.init === 'function') {
			AudioCheckPlayer.init();
		}

		// Prefs BEFORE restore — resumeOnOpen / defaultSpeed must be authoritative.
		fetchPrefs().then((prefs) => {
			applyPrefs(prefs);
			const restorePromise = typeof AudioCheckPlayer.restoreLastPlayback === 'function'
				? AudioCheckPlayer.restoreLastPlayback()
				: Promise.resolve(false);

			return restorePromise.then((restored) => {
				if (!restored && prefs && typeof prefs.defaultSpeed === 'number'
					&& typeof AudioCheckPlayer.setSpeed === 'function') {
					AudioCheckPlayer.setSpeed(prefs.defaultSpeed);
				}
				return restored;
			});
		}).catch(() => false).finally(() => {
			delete document.documentElement.dataset.acGlobalPending;
			syncVisibility(state);
		});

		// Keep overlay visibility in lockstep with queue/track changes.
		if (typeof AudioCheckPlayer.subscribe === 'function') {
			AudioCheckPlayer.subscribe(() => syncVisibility(state));
		}
		document.addEventListener('visibilitychange', () => syncVisibility(state));
		window.addEventListener('focus', () => syncVisibility(state));
	}

	function boot() {
		if (window[BOOT_FLAG]) return;
		window[BOOT_FLAG] = true;

		const state = loadState();
		if (!state || !state.markup) return;

		const needsPlayer = !!state.hasServerPlayback || hasSessionHint();
		if (!needsPlayer) {
			// Idle: no scripts beyond this boot file. Markup stays in InitialState only.
			return;
		}

		document.body.classList.add('ac-global-mini-player-host');
		document.documentElement.dataset.acPlayerMode = 'global';
		document.documentElement.dataset.acGlobalPending = '1';
		// Set before player.js auto-inits so volume popover / shortcuts stay global-scoped.
		window.AudioCheckGlobalPlayer = {
			nowPlayingUrl: state.nowPlayingUrl || '',
			isGlobal: true,
			hasServerPlayback: !!state.hasServerPlayback,
		};
		// Mount chrome immediately so the bar is visible while the stack loads
		// (avoids a multi-second blank gap on slow links).
		mountMarkup(state.markup);
		syncVisibility(state);

		const version = bootScriptVersion(state);
		loadPlayerStack(version)
			.then(() => startPlayer(state))
			.catch((err) => {
				console.error('[audiocheck] global mini-player stack failed', err);
				delete document.documentElement.dataset.acGlobalPending;
				syncVisibility(state);
			});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
