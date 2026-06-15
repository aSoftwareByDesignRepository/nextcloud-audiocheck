(function () {
	'use strict';

	function initMobileNav() {
		const shell = document.getElementById('content') || document.getElementById('app-content');
		const toggle = document.getElementById('ac-nav-toggle');
		const nav = document.getElementById('app-navigation');
		const backdrop = document.getElementById('ac-nav-backdrop');
		if (!shell || !toggle || !nav) return;

		function setOpen(open) {
			shell.classList.toggle('ac-nav-open', open);
			toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
			toggle.setAttribute('aria-label', open ? t('audiocheck', 'Close menu') : t('audiocheck', 'Open menu'));
			if (backdrop) backdrop.hidden = !open;
			if (open) {
				const first = nav.querySelector('a');
				if (first) first.focus();
			}
		}

		toggle.addEventListener('click', () => setOpen(!shell.classList.contains('ac-nav-open')));
		backdrop?.addEventListener('click', () => setOpen(false));
		nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && shell.classList.contains('ac-nav-open')) {
				setOpen(false);
				toggle.focus();
			}
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		initMobileNav();
		const root = document.getElementById('ac-view-root');
		if (root) AudioCheckRouter.init(root);

		function handleDeepLinks() {
			const params = new URLSearchParams(location.search);
			const fileId = parseInt(params.get('fileId') || '0', 10);
			const folderId = parseInt(params.get('folderId') || '0', 10);
			const prefs = window.AudioCheckUserPrefs || {};

			if (fileId > 0) {
				const resume = prefs.resumeOnOpen !== false;
				const requests = [
					AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } }),
				];
				if (resume) {
					requests.push(AudioCheckApi.get('/apps/audiocheck/api/progress', { fileId }));
				}
				Promise.all(requests).then((results) => {
					const trackResp = results[0];
					let positionMs = 0;
					if (resume && results[1] && results[1].progress) {
						const p = results[1].progress;
						if (typeof p.positionMs === 'number' && !p.finished) positionMs = p.positionMs;
						if (typeof p.playbackSpeed === 'number' && p.playbackSpeed > 0) {
							AudioCheckPlayer.setSpeed(p.playbackSpeed);
						}
					}
					AudioCheckPlayer.playQueue([trackResp.track], 0, positionMs);
					AudioCheckRouter.navigate('now-playing', {}, true);
				}).catch(() => AudioCheckMessaging.toast(t('audiocheck', 'File unavailable.'), 'error'));
				return;
			}

			if (folderId > 0) {
				AudioCheckApi.get('/apps/audiocheck/api/folders/{folderId}/tracks', null, { params: { folderId } }).then((r) => {
					const tracks = (r.items || []).filter((tr) => !tr.unavailable);
					if (!tracks.length) {
						AudioCheckMessaging.toast(t('audiocheck', 'No audio found in this folder.'), 'warning');
						return;
					}
					AudioCheckPlayer.playQueue(tracks, 0);
					AudioCheckRouter.navigate('now-playing', {}, true);
					if (r.folderName) {
						AudioCheckMessaging.toast(t('audiocheck', 'Playing folder: {name}', { name: r.folderName }));
					}
				}).catch(() => AudioCheckMessaging.toast(t('audiocheck', 'File unavailable.'), 'error'));
				return;
			}

			AudioCheckPlayer.restoreSession().then((restored) => {
				if (restored) {
					const a = document.getElementById('ac-audio');
					if (a && !a.paused) {
						AudioCheckRouter.navigate('now-playing', {}, true);
					}
				}
			});
		}

		AudioCheckApi.get('/apps/audiocheck/api/prefs').then((r) => {
			window.AudioCheckUserPrefs = r.prefs || {};
			if (r.prefs) {
				AudioCheckPlayer.setSpeed(typeof r.prefs.defaultSpeed === 'number' ? r.prefs.defaultSpeed : 100);
			}
			if (r.prefs && typeof r.prefs.defaultVolume === 'number') {
				AudioCheckPlayer.setVolumePercent(r.prefs.defaultVolume, { persist: false });
			}
			handleDeepLinks();
		}).catch(() => handleDeepLinks());
	});
})();
