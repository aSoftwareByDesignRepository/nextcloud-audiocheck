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
				sessionStorage.removeItem(SESSION_KEY);
				return;
			}
			sessionStorage.setItem(SESSION_KEY, JSON.stringify(snap));
		} catch (_) { /* storage full or unavailable */ }
	}

	function schedulePersistSession() {
		clearTimeout(sessionPersistTimer);
		sessionPersistTimer = setTimeout(persistSession, 500);
	}

	function clearSession() {
		try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
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
			const fileId = snap.queue[idx] && snap.queue[idx].fileId;
			if (!fileId) { resolve(false); return; }

			AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } }).then((r) => {
				const tracks = snap.queue.slice();
				tracks[idx] = Object.assign({}, tracks[idx], r.track);
				if (typeof snap.speed === 'number' && snap.speed > 0) {
					speed = normalizeSpeed(snap.speed);
				}
				shuffle = !!snap.shuffle;
				if (snap.repeatMode) repeatMode = snap.repeatMode;
				const positionMs = resume ? Math.max(0, snap.positionMs || 0) : 0;
				const autoplay = resume && !!snap.playing;
				window.AudioCheckPlayer.playQueue(tracks, idx, positionMs, autoplay);
				persistSession();
				resolve(true);
			}).catch(() => resolve(false));
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
		const track = currentTrack();
		const a = audio();
		const hasTrack = !!track && index >= 0;
		if (playBtn) {
			playBtn.disabled = !hasTrack && !(a && a.src);
		}
		if (prevBtn) prevBtn.disabled = !canGoPrev();
		if (nextBtn) nextBtn.disabled = !canGoNext();
	}

	function updateMini(track) {
		const title = document.getElementById('ac-mini-title');
		const artist = document.getElementById('ac-mini-artist');
		const cover = document.getElementById('ac-mini-cover');
		const playBtn = document.getElementById('ac-mini-play');
		if (!track) {
			if (title) title.textContent = t('audiocheck', 'Nothing playing');
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
		if (title) title.textContent = track.title || track.fileName || '';
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
			progressMeta[progress.fileId] = progress.updatedAt || 0;
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
			updateMini(null);
			notify();
			clearSession();
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

	function bindMiniNowOpen() {
		const now = document.getElementById('ac-mini-now');
		if (!now || now.dataset.acBound) return;
		now.dataset.acBound = '1';
		now.addEventListener('click', () => {
			if (currentTrack()) AudioCheckRouter.navigate('now-playing', {}, true);
		});
	}

	function bindAudio() {
		const a = audio();
		if (!a || a.dataset.acBound) return;
		a.dataset.acBound = '1';
		a.addEventListener('timeupdate', () => {
			updateMiniSeek();
			updateMediaSessionPosition();
			notify();
		});
		a.addEventListener('volumechange', () => {
			syncAllVolumeUis();
		});
		a.addEventListener('play', () => { updateMini(currentTrack()); startProgressTimer(); notify(); schedulePersistSession(); });
		a.addEventListener('pause', () => { updateMini(currentTrack()); saveProgress(true, false); notify(); schedulePersistSession(); });
		a.addEventListener('ended', () => {
			saveProgress(true, true);
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
		document.getElementById('ac-mini-expand')?.addEventListener('click', () => AudioCheckRouter.navigate('now-playing', {}, true));
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
			persistSession();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') saveProgress(true, false);
		});
	}

	function loadTrack(i, positionMs, autoplay) {
		const track = queue[i];
		if (!track) return;
		if (!isPlayable(track)) {
			const ni = nextIndex(i);
			if (ni >= 0 && ni !== i) loadTrack(ni, positionMs, autoplay);
			return;
		}
		index = i;
		const a = audio();
		const shouldPlay = autoplay !== false;
		a.src = AudioCheckApi.streamUrl(track.fileId);
		a.playbackRate = speed / 100;
		a.load();
		if (shouldPlay) {
			a.play().catch(() => handlePlaybackError(i));
		}
		if (positionMs > 0) {
			a.addEventListener('loadedmetadata', function onMeta() {
				a.removeEventListener('loadedmetadata', onMeta);
				a.currentTime = positionMs / 1000;
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

	function toggle() {
		const a = audio();
		if (!a) return;
		if (a.paused) a.play(); else a.pause();
		updateMini(currentTrack());
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
		playQueue(tracks, startIndex, positionMs, autoplay) {
			bindAudio();
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
		},
		enqueue(track) { queue.push(track); if (shuffle) rebuildShuffleOrder(); if (index < 0) loadTrack(0); else notify(); },
		removeAt(i) {
			if (i < 0 || i >= queue.length) return;
			queue.splice(i, 1);
			if (index === i) {
				if (queue.length === 0) { index = -1; updateMini(null); clearSession(); }
				else loadTrack(Math.min(i, queue.length - 1));
			} else if (index > i) index -= 1;
			if (shuffle) rebuildShuffleOrder();
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
		getCurrentTrack() { return currentTrack(); },
		canGoPrev,
		canGoNext,
		getRepeatMode() { return repeatMode; },
		getShuffle() { return shuffle; },
		setSpeed(centi) {
			speed = normalizeSpeed(centi);
			const a = audio();
			if (a) a.playbackRate = speed / 100;
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
		setRepeat(mode) { repeatMode = mode; notify(); },
		setShuffle(on) { shuffle = on; if (shuffle) rebuildShuffleOrder(); notify(); },
		cycleRepeat() {
			const order = [AudioCheckConstants.REPEAT_OFF, AudioCheckConstants.REPEAT_ALL, AudioCheckConstants.REPEAT_ONE];
			const i = order.indexOf(repeatMode);
			repeatMode = order[(i + 1) % order.length];
			notify();
			return repeatMode;
		},
		seekChapter,
		chapterAt,
		seekToMs(ms) { const a = audio(); if (a) a.currentTime = ms / 1000; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		toggle, next, prev,
		clearQueue,
		restoreSession,
		init() {
			bindAudio();
			bindMiniNowOpen();
			initMiniVolume();
			applyDefaultVolume();
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
