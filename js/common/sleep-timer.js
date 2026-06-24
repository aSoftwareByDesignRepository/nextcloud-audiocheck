(function () {
	'use strict';

	const PRESETS_MIN = [5, 10, 15, 30, 45, 60];
	const CUSTOM_MIN = 1;
	const CUSTOM_MAX = 480;

	let mode = 'off';
	let expiresAt = null;
	let chapterEndMs = null;
	let chapterFileId = null;
	let trackEndPending = false;
	const listeners = new Set();
	let tickTimer = null;

	function scheduleTick() {
		clearInterval(tickTimer);
		if (mode !== 'duration' || expiresAt == null) {
			tickTimer = null;
			return;
		}
		tickTimer = setInterval(() => {
			if (!isActive()) {
				cancel();
				return;
			}
			notify();
		}, 1000);
	}

	function notify() {
		listeners.forEach((fn) => {
			try { fn(getState()); } catch (_) { /* ignore */ }
		});
	}

	function getState() {
		return {
			mode,
			expiresAt,
			chapterEndMs,
			chapterFileId,
			trackEndPending,
			remainingMs: computeRemainingMs(),
			active: isActive(),
		};
	}

	function computeRemainingMs(now) {
		const ts = typeof now === 'number' ? now : Date.now();
		if (mode !== 'duration' || expiresAt == null) return 0;
		return Math.max(0, expiresAt - ts);
	}

	function isActive(now) {
		if (mode === 'track_end' || mode === 'chapter_end') return true;
		if (mode !== 'duration' || expiresAt == null) return false;
		return computeRemainingMs(now) > 0;
	}

	function cancel() {
		mode = 'off';
		expiresAt = null;
		chapterEndMs = null;
		chapterFileId = null;
		trackEndPending = false;
		clearInterval(tickTimer);
		tickTimer = null;
		notify();
	}

	function startDuration(minutes) {
		const m = Math.floor(Number(minutes));
		if (!Number.isFinite(m) || m < CUSTOM_MIN || m > CUSTOM_MAX) return false;
		mode = 'duration';
		expiresAt = Date.now() + m * 60 * 1000;
		chapterEndMs = null;
		chapterFileId = null;
		trackEndPending = false;
		scheduleTick();
		notify();
		return true;
	}

	function startTrackEnd() {
		mode = 'track_end';
		expiresAt = null;
		chapterEndMs = null;
		chapterFileId = null;
		trackEndPending = true;
		notify();
	}

	function startChapterEnd(fileId, endMs) {
		if (!fileId || !Number.isFinite(endMs) || endMs <= 0) return false;
		mode = 'chapter_end';
		expiresAt = null;
		chapterEndMs = endMs;
		chapterFileId = fileId;
		trackEndPending = false;
		notify();
		return true;
	}

	function hasReachedChapterEnd(positionMs) {
		if (chapterEndMs == null || !Number.isFinite(chapterEndMs)) return false;
		if (!Number.isFinite(positionMs) || positionMs < 0) return false;
		return positionMs >= chapterEndMs - 250;
	}

	function shouldStopOnTrackEnd() {
		return mode === 'track_end' && trackEndPending;
	}

	function consumeTrackEndStop() {
		if (!shouldStopOnTrackEnd()) return false;
		trackEndPending = false;
		mode = 'off';
		notify();
		return true;
	}

	function checkDurationExpiry(now) {
		if (mode !== 'duration' || expiresAt == null) return false;
		if (computeRemainingMs(now) > 0) return false;
		cancel();
		return true;
	}

	function checkChapterBoundary(fileId, positionMs) {
		if (mode !== 'chapter_end') return false;
		if (chapterFileId !== fileId) return false;
		if (!hasReachedChapterEnd(positionMs)) return false;
		cancel();
		return true;
	}

	function parseCustomMinutes(raw) {
		const trimmed = String(raw || '').trim();
		if (!/^\d+$/.test(trimmed)) return null;
		const minutes = Number(trimmed);
		if (!Number.isFinite(minutes)) return null;
		if (minutes < CUSTOM_MIN || minutes > CUSTOM_MAX) return null;
		return minutes;
	}

	function formatRemaining(ms) {
		const totalSec = Math.ceil(ms / 1000);
		const min = Math.floor(totalSec / 60);
		const sec = totalSec % 60;
		if (min >= 60) {
			const h = Math.floor(min / 60);
			const m = min % 60;
			return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		}
		return min + ':' + String(sec).padStart(2, '0');
	}

	function activeLabel(state) {
		const s = state || getState();
		if (!s.active) return t('audiocheck', 'Sleep timer off');
		if (s.mode === 'track_end') return t('audiocheck', 'Stops at end of track');
		if (s.mode === 'chapter_end') return t('audiocheck', 'Stops at end of chapter');
		return t('audiocheck', '{time} left', { time: formatRemaining(s.remainingMs) });
	}

	window.AudioCheckSleepTimer = {
		PRESETS_MIN,
		CUSTOM_MIN,
		CUSTOM_MAX,
		getState,
		isActive,
		cancel,
		startDuration,
		startTrackEnd,
		startChapterEnd,
		shouldStopOnTrackEnd,
		consumeTrackEndStop,
		checkDurationExpiry,
		checkChapterBoundary,
		parseCustomMinutes,
		formatRemaining,
		activeLabel,
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
})();
