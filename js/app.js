(function () {
	'use strict';

	function syncNowPlayingNav() {
		const row = document.querySelector('[data-ac-nav-id="now-playing"]');
		if (!row || !window.AudioCheckPlayer) return;
		row.hidden = !AudioCheckPlayer.getCurrentTrack();
	}

	function watchAjaxScanCron() {
		if (!window.AudioCheckApi || typeof AudioCheckApi.fetchScanStatus !== 'function') return;
		let timer = null;
		const poll = () => {
			AudioCheckApi.fetchScanStatus(null).then((scan) => {
				if (!scan || !AudioCheckApi.scanNeedsAjaxCronTick(scan)) {
					if (timer) {
						window.clearInterval(timer);
						timer = null;
					}
					return;
				}
				if (!timer) {
					timer = window.setInterval(poll, 5000);
				}
			}).catch(() => {});
		};
		poll();
	}

	document.addEventListener('DOMContentLoaded', () => {
		if (!window.AudioCheckPlayer) {
			console.error('[audiocheck] AudioCheckPlayer failed to load');
			if (window.AudioCheckMessaging) {
				AudioCheckMessaging.toast(t('audiocheck', 'Audio player failed to load. Reload the page.'), 'error');
			}
			return;
		}
		if (!window.AudioCheckTrackListUi) {
			console.error('[audiocheck] AudioCheckTrackListUi failed to load');
			if (window.AudioCheckMessaging) {
				AudioCheckMessaging.toast(t('audiocheck', 'Track list failed to load. Reload the page.'), 'error');
			}
			return;
		}

		const root = document.getElementById('ac-view-root');
		if (root) AudioCheckRouter.init(root);
		if (window.AudioCheckPageChrome) {
			AudioCheckPageChrome.bindPlayerScope();
		}
		syncNowPlayingNav();
		if (window.AudioCheckPlayer && typeof AudioCheckPlayer.subscribe === 'function') {
			AudioCheckPlayer.subscribe(syncNowPlayingNav);
		}

		const params = new URLSearchParams(location.search);
		const deepFileId = parseInt(params.get('fileId') || '0', 10);
		const deepFolderId = parseInt(params.get('folderId') || '0', 10);
		const hasDeepLink = deepFileId > 0 || deepFolderId > 0;

		// Start restore immediately — do not wait for prefs. Waiting allowed
		// setSpeed() to wipe sessionStorage before restore could read it.
		const restorePromise = hasDeepLink
			? Promise.resolve(false)
			: AudioCheckPlayer.restoreLastPlayback();

		function handleDeepLink(prefs) {
			if (deepFileId > 0) {
				const resume = prefs.resumeOnOpen !== false;
				const requests = [
					AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId: deepFileId } }),
				];
				if (resume) {
					requests.push(AudioCheckApi.get('/apps/audiocheck/api/progress', { fileId: deepFileId }));
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

			if (deepFolderId > 0) {
				AudioCheckApi.get('/apps/audiocheck/api/folders/{folderId}/tracks', null, { params: { folderId: deepFolderId } }).then((r) => {
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
			}
		}

		function applyPrefs(prefs) {
			window.AudioCheckUserPrefs = prefs || {};
			if (prefs && typeof prefs.defaultVolume === 'number') {
				AudioCheckPlayer.setVolumePercent(prefs.defaultVolume, { persist: false });
			}
			if (hasDeepLink) {
				handleDeepLink(prefs);
				return;
			}
			restorePromise.then((restored) => {
				if (!restored && prefs && typeof prefs.defaultSpeed === 'number') {
					AudioCheckPlayer.setSpeed(prefs.defaultSpeed);
				}
				if (restored && AudioCheckRouter.getCurrentView() === 'now-playing') {
					AudioCheckRouter.navigate('now-playing', {}, false);
				}
			});
		}

		AudioCheckApi.get('/apps/audiocheck/api/prefs').then((r) => {
			applyPrefs(r.prefs || {});
		}).catch(() => applyPrefs({}));

		watchAjaxScanCron();
	});
})();
