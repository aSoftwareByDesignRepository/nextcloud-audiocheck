(function () {
	'use strict';

	const queue = [];
	let index = -1;
	let repeatMode = AudioCheckConstants.REPEAT_OFF;
	let shuffle = false;
	let speed = 100;
	let volumeBeforeMute = 100;
	let lastPositionStateAt = 0;
	let volumePersistTimer = null;
	const volumeUis = new Set();
	function syncVolumeUi(ui) {
		const a = audio();
		if (!a || !ui || !ui.slider) return;
		const pct = a.muted ? 0 : Math.round(a.volume * 100);
		ui.slider.value = String(pct);
		ui.slider.setAttribute('aria-valuetext', t('audiocheck', 'Volume {percent}%', { percent: String(pct) }));
		if (ui.muteBtn && window.AudioCheckIcons) {
			const icon = a.muted || pct === 0 ? 'volume-mute' : (pct < 50 ? 'volume-low' : 'volume-high');
			AudioCheckIcons.mount(ui.muteBtn, icon);
			ui.muteBtn.setAttribute('aria-label', a.muted ? t('audiocheck', 'Unmute') : t('audiocheck', 'Mute'));
			ui.muteBtn.setAttribute('aria-pressed', a.muted ? 'true' : 'false');
		}
	}

	function syncAllVolumeUis() {
		volumeUis.forEach(syncVolumeUi);
	}

	function scheduleVolumePersist(pct) {
		clearTimeout(volumePersistTimer);
		volumePersistTimer = setTimeout(() => {
			window.AudioCheckUserPrefs = window.AudioCheckUserPrefs || {};
			window.AudioCheckUserPrefs.defaultVolume = pct;
			AudioCheckApi.put('/apps/audiocheck/api/prefs', { defaultVolume: pct }).catch(() => {});
		}, 800);
	}

	function setVolumePercent(pct, opts) {
		const options = opts || {};
		const a = audio();
		if (!a) return;
		const clamped = Math.max(0, Math.min(100, Math.round(pct)));
		a.volume = clamped / 100;
		if (clamped > 0) {
			a.muted = false;
			volumeBeforeMute = clamped;
		}
		syncAllVolumeUis();
		if (options.persist !== false) scheduleVolumePersist(clamped);
		notify();
	}

	function toggleMute() {
		const a = audio();
		if (!a) return;
		if (a.muted) {
			a.muted = false;
			if (a.volume === 0) setVolumePercent(volumeBeforeMute || 50, { persist: true });
			else announce(t('audiocheck', 'Unmuted'));
		} else {
			volumeBeforeMute = Math.round(a.volume * 100) || volumeBeforeMute;
			a.muted = true;
			announce(t('audiocheck', 'Muted'));
		}
		syncAllVolumeUis();
		notify();
	}

	function updateMediaSessionPosition() {
		if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
		const a = audio();
		if (!a || !a.duration || !Number.isFinite(a.duration)) return;
		const now = Date.now();
		if (now - lastPositionStateAt < 1000) return;
		lastPositionStateAt = now;
		try {
			navigator.mediaSession.setPositionState({
				duration: a.duration,
				playbackRate: a.playbackRate,
				position: Math.min(a.currentTime, a.duration),
			});
		} catch (_) { /* unsupported duration/state */ }
	}

	function shortcutsBlocked(e) {
		if (document.body.classList.contains('ac-modal-open')) return true;
		const target = e.target;
		if (!target || !(target instanceof Element)) return false;
		if (/input|textarea|select/i.test(target.tagName)) return true;
		if (target.isContentEditable) return true;
		return false;
	}

	function initMiniVolume() {
		const host = document.getElementById('ac-mini-volume');
		if (!host || host.dataset.acReady || !window.AudioCheckComponents) return;
		host.dataset.acReady = '1';
		host.appendChild(AudioCheckComponents.volumeControl({ idPrefix: 'ac-mini', compact: true }));
	}

	function applyDefaultVolume() {
		const prefs = window.AudioCheckUserPrefs || {};
		const vol = typeof prefs.defaultVolume === 'number' ? prefs.defaultVolume : 100;
		const a = audio();
		if (a) {
			a.volume = Math.max(0, Math.min(1, vol / 100));
			a.muted = false;
			volumeBeforeMute = vol > 0 ? vol : 100;
		}
		syncAllVolumeUis();
	}

	const listeners = new Set();
	const progressMeta = {};
	let shuffledOrder = [];
	const SESSION_KEY = 'audiocheck_playback_session';
	const SESSION_VERSION = 1;
	let sessionPersistTimer = null;

	// Durable, cross-device queue persistence. sessionStorage above stays as the
	// instant same-tab cache; the server is the source of truth that survives a
	// browser restart, a new tab, cleared storage, or another device.
	const QUEUE_ENDPOINT = '/apps/audiocheck/api/queue';
	let serverPersistTimer = null;
	let lastServerSig = '';
	let queuePlaybackPolicy = AudioCheckQueuePlaybackMode.DEFAULT_PLAYBACK_POLICY;
	const progressCache = {};

	function currentFileIds() {
		return queue.map((tr) => AudioCheckApi.validFileId(tr && tr.fileId)).filter(Boolean);
	}

	function rememberProgressEntry(entry) {
		if (!entry || !entry.fileId) return;
		progressCache[entry.fileId] = entry;
		if (entry.updatedAt) progressMeta[entry.fileId] = entry.updatedAt;
	}

	function fetchTrackProgress(fileId) {
		const cached = progressCache[fileId];
		if (cached) return Promise.resolve(cached);
		return AudioCheckApi.get('/apps/audiocheck/api/progress', { fileId }).then((data) => {
			const entry = data.progress || null;
			if (entry) rememberProgressEntry(entry);
			return entry;
		}).catch(() => null);
	}

	function resolveTrackStartMs(trackIndex) {
		const track = queue[trackIndex];
		if (!track || !isPlayable(track)) return Promise.resolve(0);
		const mode = AudioCheckQueuePlaybackMode.effectiveStartMode(queuePlaybackPolicy, trackIndex);
		if (mode === 'sequential') return Promise.resolve(0);
		const prefs = window.AudioCheckUserPrefs || {};
		if (prefs.resumeOnOpen === false) return Promise.resolve(0);
		return fetchTrackProgress(track.fileId).then((entry) => {
			if (!entry || entry.finished) return 0;
			return Math.max(0, Number(entry.positionMs) || 0);
		});
	}

	function applyQueuePatch(patch, tracksById) {
		const prevIds = currentFileIds();
		const prevPolicy = queuePlaybackPolicy;
		const priorById = {};
		queue.forEach((tr) => {
			const id = AudioCheckApi.validFileId(tr && tr.fileId);
			if (id) priorById[id] = tr;
		});
		if (tracksById) {
			Object.keys(tracksById).forEach((id) => { priorById[id] = tracksById[id]; });
		}
		queuePlaybackPolicy = AudioCheckQueuePlaybackMode.policyAfterQueueEdit(prevPolicy, prevIds, patch.fileIds);
		queue.length = 0;
		patch.fileIds.forEach((fileId) => {
			queue.push(priorById[fileId] || { fileId, title: '', unavailable: false });
		});
		index = patch.fileIds.length === 0 ? -1 : Math.max(0, Math.min(patch.currentIndex, patch.fileIds.length - 1));
		if (shuffle) rebuildShuffleOrder();
		schedulePersistSession();
		notify();
		return !!patch.truncated;
	}

	function buildServerQueuePayload() {
		const fileIds = [];
		queue.forEach((tr) => {
			const id = AudioCheckApi.validFileId(tr && tr.fileId);
			if (id) fileIds.push(id);
		});
		return {
			fileIds,
			currentIndex: index < 0 ? 0 : index,
			playbackSpeed: speed,
			shuffle: !!shuffle,
			repeatMode,
		};
	}

	function queueServerSignature(payload) {
		return payload.fileIds.join(',') + '|' + payload.currentIndex + '|'
			+ payload.playbackSpeed + '|' + (payload.shuffle ? 1 : 0) + '|' + payload.repeatMode;
	}

	function persistServerQueue(opts) {
		const options = opts || {};
		clearTimeout(serverPersistTimer);
		serverPersistTimer = null;
		const payload = buildServerQueuePayload();
		if (!payload.fileIds.length) return;
		const sig = queueServerSignature(payload);
		if (!options.force && sig === lastServerSig) return;
		lastServerSig = sig;
		const token = (window.OC && OC.requestToken) || document.querySelector('input[name="requesttoken"]')?.value;
		const body = JSON.stringify(payload);
		const unloadish = options.unload || document.visibilityState === 'hidden';
		if (unloadish || !token) {
			if (navigator.sendBeacon) {
				const beaconUrl = OC.generateUrl('/apps/audiocheck/api/queue')
					+ '?requesttoken=' + encodeURIComponent(token || '');
				navigator.sendBeacon(beaconUrl, new Blob([body], { type: 'application/json' }));
				return;
			}
			fetch(OC.generateUrl('/apps/audiocheck/api/queue'), {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { requesttoken: token || '', 'Content-Type': 'application/json', Accept: 'application/json' },
				body,
				keepalive: true,
			}).catch(() => { lastServerSig = ''; });
			return;
		}
		AudioCheckApi.put(QUEUE_ENDPOINT, payload).catch(() => { lastServerSig = ''; });
	}

	function flushQueuePersistence(unloading) {
		clearTimeout(sessionPersistTimer);
		clearTimeout(serverPersistTimer);
		sessionPersistTimer = null;
		serverPersistTimer = null;
		persistSession();
		persistServerQueue({ force: true, unload: !!unloading });
	}

	function scheduleServerQueue() {
		clearTimeout(serverPersistTimer);
		serverPersistTimer = setTimeout(() => persistServerQueue(), 400);
	}

	function clearServerQueue() {
		lastServerSig = '';
		clearTimeout(serverPersistTimer);
		serverPersistTimer = null;
		AudioCheckApi.del(QUEUE_ENDPOINT).catch(() => {});
	}

	function sessionSnapshot() {
		const track = currentTrack();
		if (!track || index < 0) return null;
		const a = audio();
		return {
			v: SESSION_VERSION,
			savedAt: Date.now(),
			index,
			positionMs: a ? Math.floor(a.currentTime * 1000) : 0,
			playing: !!(a && !a.paused && !a.ended),
			speed,
			shuffle,
			repeatMode,
			queue: queue.map((tr) => ({
				fileId: tr.fileId,
				title: tr.title,
				fileName: tr.fileName,
				artist: tr.artist,
				album: tr.album,
				unavailable: !!tr.unavailable,
			})),
		};
	}

	function persistSession() {
		clearTimeout(sessionPersistTimer);
		sessionPersistTimer = null;
		try {
			const snap = sessionSnapshot();
			if (!snap) {
				// Never wipe a saved session while bootstrap restore is still in
				// flight — setSpeed/volume prefs can schedule this with an empty
				// in-memory queue before restoreLastPlayback() finishes.
				if (!bootstrapRestoring) {
					sessionStorage.removeItem(SESSION_KEY);
				}
				return;
			}
			sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
		} catch (_) { /* storage full or unavailable */ }
	}

	function schedulePersistSession() {
		clearTimeout(sessionPersistTimer);
		sessionPersistTimer = setTimeout(persistSession, 300);
		scheduleServerQueue();
	}

	function clearSession() {
		try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
		clearServerQueue();
	}

	function restoreFromServerProgress() {
		const prefs = window.AudioCheckUserPrefs || {};
		if (prefs.resumeOnOpen === false) {
			return Promise.resolve(false);
		}
		return AudioCheckApi.get('/apps/audiocheck/api/progress').then((data) => {
			const cont = (data.progress && data.progress.continue) || [];
			if (!cont.length) return false;
			const item = cont[0];
			const fileId = item && item.fileId;
			if (!fileId) return false;
			return AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } }).then((r) => {
				const track = r.track;
				if (!track || track.unavailable) return false;
				let positionMs = 0;
				if (!item.finished && typeof item.positionMs === 'number') {
					positionMs = Math.max(0, item.positionMs);
				}
				if (typeof item.playbackSpeed === 'number' && item.playbackSpeed > 0) {
					speed = normalizeSpeed(item.playbackSpeed);
				}
				window.AudioCheckPlayer.playQueue([track], 0, positionMs, false);
				persistSession();
				return true;
			});
		}).catch(() => false);
	}

	function restoreSession() {
		return new Promise((resolve) => {
			let snap;
			try {
				const raw = sessionStorage.getItem(SESSION_KEY);
				if (!raw) { resolve(false); return; }
				snap = JSON.parse(raw);
			} catch (_) {
				resolve(false);
				return;
			}
			if (!snap || snap.v !== SESSION_VERSION || !Array.isArray(snap.queue) || !snap.queue.length) {
				resolve(false);
				return;
			}
			const prefs = window.AudioCheckUserPrefs || {};
			const resume = prefs.resumeOnOpen !== false;
			const idx = Math.max(0, Math.min(snap.index || 0, snap.queue.length - 1));
			const fileId = AudioCheckApi.validFileId(snap.queue[idx] && snap.queue[idx].fileId);
			if (!fileId) { resolve(false); return; }

			function applySnapPlayback(tracks, autoplay) {
				if (typeof snap.speed === 'number' && snap.speed > 0) {
					speed = normalizeSpeed(snap.speed);
				}
				shuffle = !!snap.shuffle;
				if (snap.repeatMode) repeatMode = snap.repeatMode;
				const positionMs = resume ? Math.max(0, snap.positionMs || 0) : 0;
				window.AudioCheckPlayer.playQueue(tracks, idx, positionMs, autoplay);
				flushQueuePersistence(false);
				announceRestored(tracks.length);
				resolve(true);
			}

			AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } }).then((r) => {
				const tracks = snap.queue.slice();
				if (r.track) tracks[idx] = Object.assign({}, tracks[idx], r.track);
				const autoplay = resume && !!snap.playing;
				applySnapPlayback(tracks, autoplay);
			}).catch(() => {
				applySnapPlayback(snap.queue.slice(), false);
			});
		});
	}

	function restoreServerQueue() {
		const prefs = window.AudioCheckUserPrefs || {};
		return AudioCheckApi.get(QUEUE_ENDPOINT).then((data) => {
			const q = data && data.queue;
			if (!q || !Array.isArray(q.items) || !q.items.length) return false;
			const tracks = q.items.slice();
			const idx = Math.max(0, Math.min(q.currentIndex || 0, tracks.length - 1));
			if (typeof q.playbackSpeed === 'number' && q.playbackSpeed > 0) {
				speed = normalizeSpeed(q.playbackSpeed);
			}
			shuffle = !!q.shuffle;
			if (q.repeatMode) repeatMode = q.repeatMode;
			const resume = prefs.resumeOnOpen !== false;
			const positionMs = resume ? Math.max(0, q.positionMs || 0) : 0;
			window.AudioCheckPlayer.playQueue(tracks, idx, positionMs, false);
			// Server already matches what we just loaded — avoid an echo write.
			lastServerSig = queueServerSignature(buildServerQueuePayload());
			flushQueuePersistence(false);
			announceRestored(tracks.length);
			return true;
		}).catch(() => false);
	}

	function announceRestored(count) {
		const msg = count > 1
			? t('audiocheck', 'Restored your queue with {count} tracks where you left off.', { count: String(count) })
			: t('audiocheck', 'Restored where you left off.');
		announce(msg);
	}

	let bootstrapRestoring = true;
	let bootstrapReadyResolve = null;
	const bootstrapReady = new Promise((resolve) => { bootstrapReadyResolve = resolve; });

	function finishBootstrapRestore() {
		bootstrapRestoring = false;
		if (bootstrapReadyResolve) {
			bootstrapReadyResolve();
			bootstrapReadyResolve = null;
		}
	}

	function restoreLastPlayback() {
		return restoreSession().then((restored) => {
			if (restored) return true;
			return restoreServerQueue();
		}).then((restored) => {
			if (restored) return true;
			return restoreFromServerProgress();
		}).finally(() => {
			finishBootstrapRestore();
			const track = activeTrack();
			updateMini(track, { announce: false });
			updateMiniSeek();
			notify();
		});
	}

	function normalizeSpeed(centi) {
		const presets = AudioCheckConstants.SPEED_PRESETS;
		const n = Math.round(Number(centi));
		if (presets.includes(n)) return n;
		return 100;
	}

	function defaultSpeedFromPrefs() {
		const prefs = window.AudioCheckUserPrefs || {};
		return normalizeSpeed(typeof prefs.defaultSpeed === 'number' ? prefs.defaultSpeed : 100);
	}

	const audio = () => document.getElementById('ac-audio');
	const announcer = () => document.getElementById('ac-announcer');

	function notify() {
		updateTransport();
		listeners.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
	}

	function announce(msg) {
		const a = announcer();
		if (a) { a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 50); }
	}

	function isPlayable(track) {
		return track && !track.unavailable;
	}

	function currentTrack() {
		return index >= 0 ? queue[index] : null;
	}

	function fileIdFromStreamSrc(src) {
		if (!src) return 0;
		const m = String(src).match(/\/api\/stream\/(\d+)/);
		return m ? parseInt(m[1], 10) : 0;
	}

	function repairTrackState() {
		const cur = currentTrack();
		if (cur) return cur;
		const a = audio();
		if (!a || !a.src) return null;
		const fileId = fileIdFromStreamSrc(a.src);
		if (!fileId) return null;

		for (let i = 0; i < queue.length; i++) {
			if (queue[i] && queue[i].fileId === fileId) {
				index = i;
				return queue[i];
			}
		}

		try {
			const raw = sessionStorage.getItem(SESSION_KEY);
			if (raw) {
				const snap = JSON.parse(raw);
				if (snap && Array.isArray(snap.queue) && snap.queue.length) {
					const idx = snap.queue.findIndex((tr) => tr && tr.fileId === fileId);
					if (idx >= 0) {
						queue.length = 0;
						snap.queue.forEach((item) => queue.push(item));
						index = idx;
						if (typeof snap.speed === 'number' && snap.speed > 0) {
							speed = normalizeSpeed(snap.speed);
						}
						shuffle = !!snap.shuffle;
						if (snap.repeatMode) repeatMode = snap.repeatMode;
						return queue[index];
					}
				}
			}
		} catch (_) { /* ignore */ }

		const stub = { fileId, title: '', fileName: '', artist: '' };
		queue.length = 0;
		queue.push(stub);
		index = 0;
		AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } })
			.then((r) => {
				if (!r.track || index < 0 || !queue[index] || queue[index].fileId !== fileId) return;
				queue[index] = r.track;
				updateMini(r.track, { announce: false });
				notify();
				schedulePersistSession();
			})
			.catch(() => {});
		return stub;
	}

	function activeTrack() {
		return currentTrack() || repairTrackState();
	}

	function canGoPrev() {
		const track = currentTrack();
		const a = audio();
		if (!track || index < 0) return false;
		if (a && a.currentTime > 3) return true;
		return prevIndex(index) >= 0;
	}

	function canGoNext() {
		return currentTrack() != null && index >= 0 && nextIndex(index) >= 0;
	}

	function updateTransport() {
		const prevBtn = document.getElementById('ac-mini-prev');
		const nextBtn = document.getElementById('ac-mini-next');
		const playBtn = document.getElementById('ac-mini-play');
		const track = activeTrack();
		const a = audio();
		const hasTrack = !!track && index >= 0;
		if (playBtn) {
			const hasSource = !!(a && a.src);
			playBtn.disabled = !hasTrack && !hasSource;
		}
		if (prevBtn) prevBtn.disabled = !canGoPrev();
		if (nextBtn) nextBtn.disabled = !canGoNext();
	}

	function updateMini(track, opts) {
		const options = opts || {};
		const title = document.getElementById('ac-mini-title');
		const artist = document.getElementById('ac-mini-artist');
		const cover = document.getElementById('ac-mini-cover');
		const playBtn = document.getElementById('ac-mini-play');
		if (!track) {
			if (title) {
				title.textContent = bootstrapRestoring
					? t('audiocheck', 'Loading playback…')
					: t('audiocheck', 'Nothing playing');
			}
			if (artist) artist.textContent = '';
			if (cover) cover.hidden = true;
			const now = document.getElementById('ac-mini-now');
			if (now) {
				now.disabled = true;
				now.classList.add('ac-mini-player__track--idle');
			}
			updateMiniSeek();
			updateTransport();
			return;
		}
		const now = document.getElementById('ac-mini-now');
		if (now) {
			now.disabled = false;
			now.classList.remove('ac-mini-player__track--idle');
		}
		if (title) {
			title.textContent = track.title || track.fileName || t('audiocheck', 'Loading playback…');
		}
		if (artist) artist.textContent = track.artist || '';
		if (cover) {
			const url = AudioCheckApi.coverUrl(track.fileId);
			if (url) {
				cover.src = url;
				cover.hidden = false;
			} else {
				cover.removeAttribute('src');
				cover.hidden = true;
			}
			cover.alt = '';
		}
		if (playBtn) {
			const a = audio();
			const playing = a && !a.paused;
			playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
			playBtn.setAttribute('aria-label', playing ? t('audiocheck', 'Pause') : t('audiocheck', 'Play'));
			if (window.AudioCheckIcons) {
				AudioCheckIcons.mount(playBtn, playing ? 'pause' : 'play');
			}
		}
		updateTransport();
		syncPlayerClearance();
		if (!options.announce) return;
		announce(t('audiocheck', 'Now playing: {title} by {artist}', {
			title: track.title || track.fileName || '',
			artist: track.artist || t('audiocheck', 'Unknown artist'),
		}));
	}

	function progressBody(finished) {
		const a = audio();
		const track = currentTrack();
		if (!a || !track) return null;
		return {
			positionMs: Math.floor(a.currentTime * 1000),
			durationMs: Math.floor((a.duration || 0) * 1000),
			playbackSpeed: speed,
			finished: !!finished,
			clientUpdatedAt: progressMeta[track.fileId] || 0,
		};
	}

	function rememberProgress(progress) {
		if (progress && progress.fileId) {
			rememberProgressEntry(progress);
		}
	}

	function saveProgress(force, finished) {
		clearTimeout(saveTimer);
		if (!force && document.visibilityState !== 'hidden') {
			saveTimer = setTimeout(() => flushSaveProgress(finished), 400);
			return;
		}
		flushSaveProgress(finished);
	}

	function flushSaveProgress(finished) {
		clearTimeout(saveTimer);
		saveTimer = null;
		const body = progressBody(finished);
		if (!body) return;
		const track = currentTrack();
		if (!finished && lastSavedPos >= 0 && Math.abs(body.positionMs - lastSavedPos) < 500 && (Date.now() - lastSavedAt) < 3000) {
			return;
		}
		lastSavedPos = body.positionMs;
		lastSavedAt = Date.now();
		const url = OC.generateUrl('/apps/audiocheck/api/progress/{fileId}', { fileId: track.fileId });
		const token = (window.OC && OC.requestToken) || document.querySelector('input[name="requesttoken"]')?.value;
		const payload = JSON.stringify(body);
		if (document.visibilityState === 'hidden' || !token) {
			if (navigator.sendBeacon) {
				const beaconUrl = url + (url.includes('?') ? '&' : '?') + 'requesttoken=' + encodeURIComponent(token || '');
				navigator.sendBeacon(beaconUrl, new Blob([payload], { type: 'application/json' }));
			} else {
				fetch(url, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { requesttoken: token, 'Content-Type': 'application/json', Accept: 'application/json' },
					body: payload,
					keepalive: true,
				}).catch(() => {});
			}
			return;
		}
		AudioCheckApi.put('/apps/audiocheck/api/progress/{fileId}', body, { params: { fileId: track.fileId } })
			.then((r) => { if (r.progress) rememberProgress(r.progress); })
			.catch(() => {});
	}

	let saveTimer = null;
	let lastSavedAt = 0;
	let lastSavedPos = -1;
	let progressTimer = null;
	function startProgressTimer() {
		clearInterval(progressTimer);
		progressTimer = setInterval(() => saveProgress(false, false), 10000);
	}

	function rebuildShuffleOrder() {
		shuffledOrder = queue.map((_, i) => i).filter((i) => isPlayable(queue[i]));
		for (let i = shuffledOrder.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]];
		}
		if (index >= 0 && shuffledOrder.length > 1) {
			const pos = shuffledOrder.indexOf(index);
			if (pos > 0) [shuffledOrder[0], shuffledOrder[pos]] = [shuffledOrder[pos], shuffledOrder[0]];
		}
	}

	function nextIndex(from) {
		if (queue.length === 0) return -1;
		if (shuffle && shuffledOrder.length > 0) {
			const pos = shuffledOrder.indexOf(from);
			for (let i = pos + 1; i < shuffledOrder.length; i++) {
				if (isPlayable(queue[shuffledOrder[i]])) return shuffledOrder[i];
			}
			if (repeatMode === AudioCheckConstants.REPEAT_ALL) {
				for (let i = 0; i < shuffledOrder.length; i++) {
					if (isPlayable(queue[shuffledOrder[i]])) return shuffledOrder[i];
				}
			}
			return -1;
		}
		for (let i = from + 1; i < queue.length; i++) {
			if (isPlayable(queue[i])) return i;
		}
		if (repeatMode === AudioCheckConstants.REPEAT_ALL) {
			for (let i = 0; i <= from; i++) {
				if (isPlayable(queue[i])) return i;
			}
		}
		return -1;
	}

	function prevIndex(from) {
		if (queue.length === 0) return -1;
		if (shuffle && shuffledOrder.length > 0) {
			const pos = shuffledOrder.indexOf(from);
			for (let i = pos - 1; i >= 0; i--) {
				if (isPlayable(queue[shuffledOrder[i]])) return shuffledOrder[i];
			}
			if (repeatMode === AudioCheckConstants.REPEAT_ALL) {
				for (let i = shuffledOrder.length - 1; i >= 0; i--) {
					if (isPlayable(queue[shuffledOrder[i]])) return shuffledOrder[i];
				}
			}
			return -1;
		}
		for (let i = from - 1; i >= 0; i--) {
			if (isPlayable(queue[i])) return i;
		}
		if (repeatMode === AudioCheckConstants.REPEAT_ALL) {
			for (let i = queue.length - 1; i > from; i--) {
				if (isPlayable(queue[i])) return i;
			}
		}
		return -1;
	}

	function chapterAt(ms, chapters) {
		if (!chapters || !chapters.length) return -1;
		for (let i = chapters.length - 1; i >= 0; i--) {
			if (ms >= (chapters[i].start_ms || 0)) return i;
		}
		return 0;
	}

	function seekChapter(delta) {
		const track = currentTrack();
		const a = audio();
		if (!track || !a || !track.chapters || !track.chapters.length) return;
		const ms = Math.floor(a.currentTime * 1000);
		const cur = chapterAt(ms, track.chapters);
		const next = Math.max(0, Math.min(track.chapters.length - 1, cur + delta));
		a.currentTime = (track.chapters[next].start_ms || 0) / 1000;
		announce(t('audiocheck', 'Chapter: {title}', { title: track.chapters[next].title || '' }));
	}

	function cycleSpeed(delta) {
		const presets = AudioCheckConstants.SPEED_PRESETS;
		let idx = presets.indexOf(speed);
		if (idx < 0) idx = presets.indexOf(100);
		idx = Math.max(0, Math.min(presets.length - 1, idx + delta));
		speed = presets[idx];
		const a = audio();
		if (a) a.playbackRate = speed / 100;
		announce(t('audiocheck', 'Speed: {speed}×', { speed: (speed / 100).toFixed(2) }));
		notify();
	}

	function handlePlaybackError(i) {
		if (i >= 0 && queue[i]) {
			queue[i].unavailable = true;
			announce(t('audiocheck', 'Track unavailable, skipping.'));
		}
		const ni = nextIndex(i);
		if (ni >= 0 && ni !== i) loadTrack(ni);
		else {
			index = -1;
			const a = audio();
			if (a) {
				a.pause();
				a.removeAttribute('src');
				try { a.load(); } catch (_) { /* ignore */ }
			}
			updateMini(null);
			notify();
			// Stop local playback but deliberately keep the durable server queue.
			// "Unavailable" here means "could not be played in THIS browser/session"
			// (e.g. an unsupported codec), not that the user discarded it — so the
			// curated queue must remain recoverable on reload or another device.
			// Only explicit user actions (clearQueue / removing the last item) wipe
			// the persisted queue.
		}
	}

	let seekDragging = false;

	function updateMiniSeek() {
		const a = audio();
		const seek = document.getElementById('ac-mini-seek');
		const posEl = document.getElementById('ac-mini-pos');
		const durEl = document.getElementById('ac-mini-dur');
		if (!a || !seek) return;
		if (seekDragging) return;
		if (a.duration && Number.isFinite(a.duration)) {
			seek.max = String(Math.floor(a.duration * 1000));
			seek.value = String(Math.floor(a.currentTime * 1000));
			const posText = AudioCheckTime.formatMs(a.currentTime * 1000);
			const durText = AudioCheckTime.formatMs(a.duration * 1000);
			seek.setAttribute('aria-valuetext', posText + ' ' + t('audiocheck', 'of') + ' ' + durText);
			if (posEl) posEl.textContent = posText;
			if (durEl) durEl.textContent = durText;
		} else {
			seek.value = '0';
			if (posEl) posEl.textContent = AudioCheckTime.formatMs(0);
			if (durEl) durEl.textContent = AudioCheckTime.formatMs(0);
		}
	}

	function openNowPlaying() {
		if (!window.AudioCheckRouter) return;
		if (AudioCheckRouter.getCurrentView() === 'now-playing') return;
		AudioCheckRouter.navigate('now-playing', {}, true);
	}

	function syncPlayerClearance() {
		const player = document.getElementById('ac-mini-player');
		if (!player) return;
		document.documentElement.style.setProperty('--ac-player-clearance', player.offsetHeight + 'px');
	}

	function bindPlayerClearance() {
		const player = document.getElementById('ac-mini-player');
		if (!player || player.dataset.acClearanceBound) return;
		player.dataset.acClearanceBound = '1';
		syncPlayerClearance();
		if (typeof ResizeObserver !== 'undefined') {
			new ResizeObserver(() => syncPlayerClearance()).observe(player);
		} else {
			window.addEventListener('resize', syncPlayerClearance);
		}
	}

	function bindMiniNowOpen() {
		const now = document.getElementById('ac-mini-now');
		if (now && !now.dataset.acBound) {
			now.dataset.acBound = '1';
			now.addEventListener('click', () => {
				if (activeTrack()) openNowPlaying();
			});
		}
		const expand = document.getElementById('ac-mini-expand');
		if (expand && !expand.dataset.acBound) {
			expand.dataset.acBound = '1';
			expand.addEventListener('click', openNowPlaying);
		}
	}

	function bindAudio() {
		const a = audio();
		if (!a || a.dataset.acBound) return;
		a.dataset.acBound = '1';
		a.addEventListener('timeupdate', () => {
			updateMiniSeek();
			updateMediaSessionPosition();
			const track = currentTrack();
			const ST = window.AudioCheckSleepTimer;
			if (ST && track) {
				if (ST.checkDurationExpiry()) {
					a.pause();
					announce(t('audiocheck', 'Sleep timer ended — playback paused'));
				} else if (ST.checkChapterBoundary(track.fileId, Math.floor(a.currentTime * 1000))) {
					a.pause();
					announce(t('audiocheck', 'Sleep timer ended — playback paused'));
				}
			}
			notify();
		});
		a.addEventListener('volumechange', () => {
			syncAllVolumeUis();
		});
		a.addEventListener('play', () => {
			updateMini(activeTrack(), { announce: false });
			startProgressTimer();
			notify();
			schedulePersistSession();
		});
		a.addEventListener('pause', () => {
			updateMini(activeTrack(), { announce: false });
			saveProgress(true, false);
			notify();
			schedulePersistSession();
		});
		a.addEventListener('ended', () => {
			saveProgress(true, true);
			const ST = window.AudioCheckSleepTimer;
			if (ST && ST.consumeTrackEndStop()) {
				a.pause();
				announce(t('audiocheck', 'Sleep timer ended — playback paused'));
				notify();
				return;
			}
			if (repeatMode === AudioCheckConstants.REPEAT_ONE) { a.currentTime = 0; a.play(); return; }
			next();
		});
		a.addEventListener('error', () => {
			AudioCheckMessaging.toast(t('audiocheck', 'This file may not play in your browser.'), 'error');
			handlePlaybackError(index);
		});
		document.getElementById('ac-mini-play')?.addEventListener('click', toggle);
		document.getElementById('ac-mini-prev')?.addEventListener('click', prev);
		document.getElementById('ac-mini-next')?.addEventListener('click', next);
		document.getElementById('ac-mini-seek')?.addEventListener('input', (e) => {
			const ms = parseInt(e.target.value, 10);
			if (a.duration) a.currentTime = ms / 1000;
			const posEl = document.getElementById('ac-mini-pos');
			if (posEl) posEl.textContent = AudioCheckTime.formatMs(ms);
		});
		const miniSeek = document.getElementById('ac-mini-seek');
		miniSeek?.addEventListener('pointerdown', () => { seekDragging = true; });
		miniSeek?.addEventListener('pointerup', () => { seekDragging = false; });
		miniSeek?.addEventListener('pointercancel', () => { seekDragging = false; });
		document.addEventListener('keydown', (e) => {
			if (shortcutsBlocked(e)) return;
			const track = currentTrack();
			if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.preventDefault(); toggle(); return; }
			if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMute(); return; }
			if (e.key === 'ArrowLeft' && track) {
				e.preventDefault();
				if (e.shiftKey) prev();
				else a.currentTime = Math.max(0, a.currentTime - 10);
				return;
			}
			if (e.key === 'ArrowRight' && track) {
				e.preventDefault();
				if (e.shiftKey) next();
				else a.currentTime = Math.min(a.duration || 0, a.currentTime + 10);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setVolumePercent(Math.round(a.volume * 100) + 10, { persist: true });
				announce(t('audiocheck', 'Volume {percent}%', { percent: String(Math.round(a.volume * 100)) }));
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setVolumePercent(Math.round(a.volume * 100) - 10, { persist: true });
				announce(t('audiocheck', 'Volume {percent}%', { percent: String(Math.round(a.volume * 100)) }));
				return;
			}
			if (e.key === '[') { e.preventDefault(); cycleSpeed(-1); return; }
			if (e.key === ']') { e.preventDefault(); cycleSpeed(1); return; }
			if (e.key === 'j' || e.key === 'J') { e.preventDefault(); seekChapter(-1); return; }
			if (e.key === 'l' || e.key === 'L') { e.preventDefault(); seekChapter(1); }
		});
		if ('mediaSession' in navigator) {
			navigator.mediaSession.setActionHandler('play', () => a.play());
			navigator.mediaSession.setActionHandler('pause', () => a.pause());
			navigator.mediaSession.setActionHandler('previoustrack', prev);
			navigator.mediaSession.setActionHandler('nexttrack', next);
		}
		window.addEventListener('beforeunload', () => {
			saveProgress(true, false);
			flushQueuePersistence(true);
		});
		window.addEventListener('pagehide', () => {
			flushQueuePersistence(true);
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				saveProgress(true, false);
				flushQueuePersistence(true);
			}
		});
	}

	function loadTrack(i, positionMs, autoplay) {
		const track = queue[i];
		if (!track) return;
		if (!isPlayable(track)) {
			const ni = nextIndex(i);
			if (ni >= 0 && ni !== i) loadTrack(ni, undefined, autoplay);
			return;
		}
		index = i;
		const a = audio();
		const shouldPlay = autoplay !== false;

		function beginPlayback(seekMs) {
			a.src = AudioCheckApi.streamUrl(track.fileId);
			a.playbackRate = speed / 100;
			a.load();
			if (shouldPlay) {
				const playPromise = a.play();
				if (playPromise && typeof playPromise.catch === 'function') {
					playPromise.catch((err) => {
						const name = err && err.name;
						if (name === 'AbortError') return;
						if (name === 'NotAllowedError') {
							if (index === i) {
								updateMini(queue[i], { announce: false });
								notify();
								announce(t('audiocheck', 'Ready to resume — press play to continue.'));
							}
							return;
						}
						handlePlaybackError(i);
					});
				}
			}
			if (seekMs > 0) {
				a.addEventListener('loadedmetadata', function onMeta() {
					a.removeEventListener('loadedmetadata', onMeta);
					a.currentTime = seekMs / 1000;
				});
			}
			if (!track.chapters) {
				AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId: track.fileId } }).then((r) => {
					if (r.track) {
						queue[i] = Object.assign({}, track, r.track);
						notify();
					}
				}).catch(() => {});
			}
			updateMini(track);
			if ('mediaSession' in navigator) {
				const artwork = [];
				const coverSrc = AudioCheckApi.coverUrl(track.fileId);
				if (coverSrc) {
					artwork.push({ src: coverSrc, sizes: '256x256', type: 'image/jpeg' });
				}
				navigator.mediaSession.metadata = new MediaMetadata({
					title: track.title || track.fileName,
					artist: track.artist || '',
					album: track.album || '',
					artwork,
				});
			}
			notify();
			schedulePersistSession();
		}

		if (arguments.length >= 2 && positionMs !== undefined) {
			beginPlayback(Number(positionMs) || 0);
			return;
		}
		resolveTrackStartMs(i).then((seekMs) => beginPlayback(seekMs));
	}

	function toggle() {
		const a = audio();
		if (!a) return;
		const track = activeTrack();
		if (a.paused) {
			a.play().catch(() => handlePlaybackError(index));
		} else {
			a.pause();
		}
		updateMini(track || activeTrack(), { announce: false });
	}

	function next() {
		if (queue.length === 0) return;
		const ni = nextIndex(index);
		if (ni >= 0) loadTrack(ni);
	}

	function prev() {
		const a = audio();
		if (a && a.currentTime > 3) {
			a.currentTime = 0;
			updateTransport();
			return;
		}
		const pi = prevIndex(index);
		if (pi >= 0) loadTrack(pi);
	}

	window.AudioCheckPlayer = {
		playQueue(tracks, startIndex, positionMs, autoplay, playbackOptions) {
			bindAudio();
			const opts = playbackOptions || {};
			if (opts.playbackPolicy) {
				queuePlaybackPolicy = opts.playbackPolicy;
			} else if (tracks.length > 1 && opts.playbackMode) {
				const start = startIndex || 0;
				queuePlaybackPolicy = AudioCheckQueuePlaybackMode.resolvePlaybackPolicyForQueueStart({
					fileCount: tracks.length,
					explicitMode: opts.playbackMode,
					currentIndex: start,
					resumeAnchorIndex: opts.resumeAnchorIndex != null ? opts.resumeAnchorIndex : null,
				});
			} else if (tracks.length <= 1) {
				queuePlaybackPolicy = AudioCheckQueuePlaybackMode.DEFAULT_PLAYBACK_POLICY;
			}
			queue.length = 0;
			tracks.forEach((tr) => queue.push(tr));
			if (shuffle) rebuildShuffleOrder();
			let start = startIndex || 0;
			if (!isPlayable(queue[start])) {
				const ni = nextIndex(start - 1);
				start = ni >= 0 ? ni : 0;
			}
			let seekMs = 0;
			if (arguments.length < 3) {
				speed = defaultSpeedFromPrefs();
			} else {
				seekMs = Number(positionMs) || 0;
			}
			const a = audio();
			if (a) a.playbackRate = speed / 100;
			loadTrack(start, seekMs, autoplay);
			// Persist immediately when the user starts a queue — do not rely on
			// debounced timers alone (F5 within 1–2s would lose everything).
			if (tracks.length) {
				persistSession();
				persistServerQueue({ force: true });
			}
		},
		playQueueFromHere(tracks, startIndex, positionMs) {
			const idx = typeof startIndex === 'number' && startIndex >= 0 ? startIndex : 0;
			const policy = AudioCheckQueuePlaybackMode.resolvePlaybackPolicyForQueueStart({
				fileCount: tracks.length,
				explicitMode: 'resume',
				currentIndex: idx,
				resumeAnchorIndex: tracks.length > 1 ? idx : null,
			});
			this.playQueue(tracks, idx, positionMs, true, { playbackPolicy: policy });
		},
		enqueue(track) {
			if (!isPlayable(track)) return false;
			const prevIds = currentFileIds();
			if (prevIds.includes(track.fileId)) return false;
			const patch = AudioCheckQueueMerge.queueAddTracks(prevIds, index < 0 ? 0 : index, [track.fileId]);
			const truncated = applyQueuePatch(patch, { [track.fileId]: track });
			if (truncated) {
				AudioCheckMessaging.toast(t('audiocheck', 'Queue is full — some tracks were not added.'), 'warning');
			}
			if (index < 0 && queue.length) loadTrack(0);
			return true;
		},
		enqueueAll(tracks) {
			const existing = new Set(currentFileIds());
			const toAdd = (tracks || []).filter((tr) => isPlayable(tr) && !existing.has(tr.fileId));
			if (!toAdd.length) return 0;
			const shouldStart = index < 0;
			const prevIds = currentFileIds();
			const patch = AudioCheckQueueMerge.queueAddTracks(prevIds, index < 0 ? 0 : index, toAdd.map((tr) => tr.fileId));
			const byId = {};
			toAdd.forEach((tr) => { byId[tr.fileId] = tr; });
			const truncated = applyQueuePatch(patch, byId);
			if (truncated) {
				AudioCheckMessaging.toast(t('audiocheck', 'Queue is full — some tracks were not added.'), 'warning');
			}
			if (shouldStart && queue.length) loadTrack(0);
			return toAdd.length;
		},
		playNext(trackOrTracks) {
			const incoming = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
			const playable = incoming.filter((tr) => tr && isPlayable(tr));
			if (!playable.length) return false;
			const prevIds = currentFileIds();
			const cur = index < 0 ? 0 : index;
			const patch = AudioCheckQueueMerge.queuePlayNext(prevIds, cur, playable.map((tr) => tr.fileId));
			const byId = {};
			playable.forEach((tr) => { byId[tr.fileId] = tr; });
			const truncated = applyQueuePatch(patch, byId);
			if (truncated) {
				AudioCheckMessaging.toast(t('audiocheck', 'Queue is full — some tracks were not added.'), 'warning');
			}
			AudioCheckMessaging.toast(t('audiocheck', 'Queued to play next'));
			return true;
		},
		removeAt(i) {
			if (i < 0 || i >= queue.length) return;
			queue.splice(i, 1);
			let emptied = false;
			if (index === i) {
				if (queue.length === 0) { index = -1; updateMini(null); clearSession(); emptied = true; }
				else loadTrack(Math.min(i, queue.length - 1));
			} else if (index > i) index -= 1;
			if (shuffle) rebuildShuffleOrder();
			if (!emptied) schedulePersistSession();
			notify();
		},
		moveItem(from, to) {
			if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
			const [item] = queue.splice(from, 1);
			queue.splice(to, 0, item);
			if (index === from) index = to;
			else if (from < index && to >= index) index -= 1;
			else if (from > index && to <= index) index += 1;
			if (shuffle) rebuildShuffleOrder();
			schedulePersistSession();
			notify();
		},
		clearQueue() {
			const a = audio();
			if (a) {
				a.pause();
				a.removeAttribute('src');
				try { a.load(); } catch (_) { /* ignore */ }
			}
			queue.length = 0;
			index = -1;
			updateMini(null);
			clearSession();
			notify();
		},
		getQueue() { return queue.slice(); },
		getCurrentIndex() { return index; },
		getCurrentTrack() { return activeTrack(); },
		canGoPrev,
		canGoNext,
		getRepeatMode() { return repeatMode; },
		getShuffle() { return shuffle; },
		setSpeed(centi) {
			speed = normalizeSpeed(centi);
			const a = audio();
			if (a) a.playbackRate = speed / 100;
			if (!bootstrapRestoring) schedulePersistSession();
		},
		setVolumePercent,
		getVolumePercent() { const a = audio(); return a ? (a.muted ? 0 : Math.round(a.volume * 100)) : 100; },
		isMuted() { const a = audio(); return !!(a && a.muted); },
		toggleMute,
		registerVolumeUi(ui) {
			volumeUis.add(ui);
			syncVolumeUi(ui);
			return () => volumeUis.delete(ui);
		},
		getQueuePlaybackPolicy() { return Object.assign({}, queuePlaybackPolicy); },
		setQueuePlaybackPolicy(policy) {
			if (!policy || !policy.mode) return;
			queuePlaybackPolicy = {
				mode: policy.mode === 'sequential' ? 'sequential' : 'resume',
				resumeAnchorIndex: policy.resumeAnchorIndex != null ? policy.resumeAnchorIndex : null,
			};
			notify();
		},
		setRepeat(mode) { repeatMode = mode; schedulePersistSession(); notify(); },
		setShuffle(on) { shuffle = on; if (shuffle) rebuildShuffleOrder(); schedulePersistSession(); notify(); },
		cycleRepeat() {
			const order = [AudioCheckConstants.REPEAT_OFF, AudioCheckConstants.REPEAT_ALL, AudioCheckConstants.REPEAT_ONE];
			const i = order.indexOf(repeatMode);
			repeatMode = order[(i + 1) % order.length];
			schedulePersistSession();
			notify();
			return repeatMode;
		},
		seekChapter,
		chapterAt,
		seekToMs(ms) { const a = audio(); if (a) a.currentTime = ms / 1000; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		toggle, next, prev,
		restoreSession,
		restoreLastPlayback,
		whenReady() { return bootstrapReady; },
		isRestoring() { return bootstrapRestoring; },
		init() {
			bindAudio();
			bindMiniNowOpen();
			bindPlayerClearance();
			initMiniVolume();
			applyDefaultVolume();
			if (bootstrapRestoring && !activeTrack()) {
				updateMini(null);
			} else {
				const track = activeTrack();
				if (track) updateMini(track, { announce: false });
			}
			updateTransport();
			updateMiniSeek();
		},
	};
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => window.AudioCheckPlayer.init());
	} else {
		window.AudioCheckPlayer.init();
	}
})();
