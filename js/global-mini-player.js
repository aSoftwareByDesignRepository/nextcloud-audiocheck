(function () {
	'use strict';

	/**
	 * Global mini-player boot for non-AudioCheck pages.
	 * Loads the full player stack only when server/session hints say playback
	 * may restore — idle Files users do not pay for 10 extra scripts.
	 */
	const SESSION_KEY = 'audiocheck_playback_session';
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
			if (typeof OCP !== 'undefined' && OCP.InitialState && typeof OCP.InitialState.load === 'function') {
				return OCP.InitialState.load('audiocheck', 'global-mini-player');
			}
		} catch (e) {
			// Missing state = nothing to mount.
		}
		return null;
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

	function scriptSrc(name) {
		if (typeof OC !== 'undefined' && typeof OC.filePath === 'function') {
			return OC.filePath('audiocheck', 'js', name + '.js');
		}
		return '/apps/audiocheck/js/' + name + '.js';
	}

	function loadScript(name) {
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
			s.src = scriptSrc(name);
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

	function loadPlayerStack() {
		let chain = Promise.resolve();
		PLAYER_SCRIPTS.forEach((name) => {
			chain = chain.then(() => loadScript(name));
		});
		return chain;
	}

	function mountMarkup(markup) {
		if (!markup || document.getElementById('ac-mini-player')) {
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
			: false;
		const expectRestore = !!(state && state.hasServerPlayback) || hasSessionHint();
		const show = !!(track || (restoring && expectRestore));
		player.hidden = !show;
		player.setAttribute('aria-hidden', show ? 'false' : 'true');
		if ('inert' in HTMLElement.prototype) {
			player.inert = !show;
		}
		document.body.classList.toggle('ac-global-mini-player-visible', show);
		if (window.AudioCheckPlayer && typeof AudioCheckPlayer.syncPlayerClearance === 'function') {
			AudioCheckPlayer.syncPlayerClearance();
		} else if (show) {
			document.documentElement.style.setProperty('--ac-player-clearance', player.offsetHeight + 'px');
		} else {
			document.documentElement.style.setProperty('--ac-player-clearance', '0px');
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
			return;
		}

		if (typeof AudioCheckPlayer.init === 'function') {
			AudioCheckPlayer.init();
		}

		const restorePromise = typeof AudioCheckPlayer.restoreLastPlayback === 'function'
			? AudioCheckPlayer.restoreLastPlayback()
			: Promise.resolve(false);

		function applyPrefs(prefs) {
			window.AudioCheckUserPrefs = prefs || {};
			if (prefs && typeof prefs.defaultVolume === 'number' && typeof AudioCheckPlayer.setVolumePercent === 'function') {
				AudioCheckPlayer.setVolumePercent(prefs.defaultVolume, { persist: false });
			}
			restorePromise.then((restored) => {
				if (!restored && prefs && typeof prefs.defaultSpeed === 'number' && typeof AudioCheckPlayer.setSpeed === 'function') {
					AudioCheckPlayer.setSpeed(prefs.defaultSpeed);
				}
				syncVisibility(state);
			}).catch(() => syncVisibility(state));
		}

		if (window.AudioCheckApi && typeof AudioCheckApi.get === 'function') {
			AudioCheckApi.get('/apps/audiocheck/api/prefs').then(applyPrefs).catch(() => applyPrefs({}));
		} else {
			applyPrefs({});
		}

		document.addEventListener('visibilitychange', () => syncVisibility(state));
		window.addEventListener('focus', () => syncVisibility(state));
	}

	function boot() {
		const state = loadState();
		if (!state || !state.markup) return;

		const needsPlayer = !!state.hasServerPlayback || hasSessionHint();
		if (!needsPlayer) {
			// Idle: no scripts beyond this boot file. Markup stays in InitialState only.
			return;
		}

		loadPlayerStack()
			.then(() => startPlayer(state))
			.catch((err) => console.error('[audiocheck] global mini-player stack failed', err));
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
