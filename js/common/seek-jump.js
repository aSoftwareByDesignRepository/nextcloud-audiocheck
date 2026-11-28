(function () {
	'use strict';

	/** Locked skip interval for −/+ jump buttons, ←/→, and MediaSession (seconds). */
	const SEEK_JUMP_SEC = 30;

	/**
	 * Clamp a relative seek within the current track (never wraps to another track).
	 * @param {number} positionSec
	 * @param {number} deltaSec
	 * @param {number} durationSec
	 * @returns {number}
	 */
	function clampSeekBySeconds(positionSec, deltaSec, durationSec) {
		const cur = Number.isFinite(positionSec) ? positionSec : 0;
		const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
		const delta = Number.isFinite(deltaSec) ? deltaSec : 0;
		let next = cur + delta;
		if (next < 0) next = 0;
		if (dur > 0 && next > dur) next = dur;
		return next;
	}

	/**
	 * @param {{ pendingTargetSec: number|null, positionSec: number, deltaSec: number, durationSec: number }} params
	 * @returns {{ nextSec: number, pendingTargetSec: number }}
	 */
	function resolveSeekByTarget(params) {
		const pending = params.pendingTargetSec;
		const base = pending != null && Number.isFinite(pending) ? pending : params.positionSec;
		const nextSec = clampSeekBySeconds(base, params.deltaSec, params.durationSec);
		return { nextSec: nextSec, pendingTargetSec: nextSec };
	}

	/**
	 * MediaSession often passes seekOffset=10. Product contract is hard-locked
	 * SEEK_JUMP_SEC — ignore UA offset so OS gestures match on-screen ±30.
	 * @param {MediaSessionActionDetails|null|undefined} _details
	 * @param {number} lockedSec
	 * @returns {number}
	 */
	function resolveMediaSessionDeltaSec(_details, lockedSec) {
		const locked = Number(lockedSec);
		return Number.isFinite(locked) && locked > 0 ? locked : SEEK_JUMP_SEC;
	}

	/**
	 * Mini player is redundant on full Now Playing (same as mobile Home).
	 * Coerce so null/undefined/non-strings never throw or false-positive.
	 */
	function shouldHideMiniPlayer(viewId) {
		return String(viewId || '') === 'now-playing';
	}

	/** EOF guard for committed scrubs — landing on `duration` fires `ended`. */
	const SCRUB_EOF_GUARD_SEC = 0.25;

	/**
	 * Clamp a committed absolute scrub (range-slider `change`) into the track.
	 * Negative/NaN → 0; at/after duration → `duration − 0.25 s` so a committed
	 * scrub never lands on EOS and auto-advances the queue.
	 * @param {number} valueMs Slider value in ms
	 * @param {number} durationSec Known duration in seconds (0 when unknown)
	 * @returns {number} Target in seconds
	 */
	function resolveScrubTargetSec(valueMs, durationSec) {
		const ms = Number(valueMs);
		const sec = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
		const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
		if (dur <= 0) return sec;
		return Math.min(sec, Math.max(0, dur - SCRUB_EOF_GUARD_SEC));
	}

	/** Committed-scrub paint convergence/timeout bounds. */
	const SCRUB_PAINT_EPSILON_MS = 750;
	const SCRUB_PAINT_TIMEOUT_MS = 2000;

	/**
	 * Committed-paint hold: after a scrub commits, the paint functions keep
	 * showing the COMMITTED value until the media clock converges or the hold
	 * expires — no one-frame snap-back to a stale currentTime.
	 * @returns {{ note: (ms:number)=>void, clear: ()=>void, paintMs: (currentTimeSec:number, nowMs?:number)=>number|null }}
	 */
	function createCommittedScrubPaint() {
		let committed = null;
		return {
			note(ms) {
				committed = { ms: ms, atMs: Date.now() };
			},
			clear() {
				committed = null;
			},
			paintMs(currentTimeSec, nowMs) {
				if (!committed) return null;
				const now = Number.isFinite(nowMs) ? nowMs : Date.now();
				const cur = Number.isFinite(currentTimeSec) && currentTimeSec > 0
					? Math.floor(currentTimeSec * 1000)
					: 0;
				if (now - committed.atMs >= SCRUB_PAINT_TIMEOUT_MS
					|| Math.abs(cur - committed.ms) < SCRUB_PAINT_EPSILON_MS) {
					committed = null;
					return null;
				}
				return committed.ms;
			},
		};
	}

	/**
	 * Shared preview/commit split for range scrub sliders (mini + Now Playing).
	 * `input` only previews (pos label + aria-valuetext — NEVER currentTime);
	 * `change` commits exactly one seek + one progress save. The drag latch
	 * holds until `change` (or a short release after pointerup when the value
	 * never moved and no `change` arrives) so paint functions can't repaint a
	 * stale position mid-release.
	 * @param {HTMLInputElement} input
	 * @param {{ preview?: (ms:number)=>void, commit?: (ms:number)=>void, userIntent?: ()=>void }} hooks
	 * @returns {{ dragging: () => boolean }}
	 */
	function bindScrubSlider(input, hooks) {
		const cb = hooks || {};
		let dragging = false;
		let releaseTimer = null;
		const release = () => {
			dragging = false;
			if (releaseTimer) {
				clearTimeout(releaseTimer);
				releaseTimer = null;
			}
		};
		input.addEventListener('pointerdown', () => { dragging = true; });
		input.addEventListener('pointercancel', release);
		input.addEventListener('pointerup', () => {
			// `change` fires right after release when the value moved; when the
			// thumb never moved there is no `change` — release the latch shortly
			// so paints resume instead of sticking forever.
			if (releaseTimer) clearTimeout(releaseTimer);
			releaseTimer = setTimeout(release, 150);
		});
		input.addEventListener('input', () => {
			const ms = parseInt(input.value, 10) || 0;
			// A real user gesture kills deferred resume restores + pending ±30 plans.
			if (typeof cb.userIntent === 'function') cb.userIntent();
			if (typeof cb.preview === 'function') cb.preview(ms);
		});
		input.addEventListener('change', () => {
			const ms = parseInt(input.value, 10) || 0;
			release();
			// Keyboard commits arrive without a prior pointerdown — commit
			// unconditionally (never assume drag state).
			if (typeof cb.commit === 'function') cb.commit(ms);
		});
		return {
			dragging() { return dragging; },
		};
	}

	window.AudioCheckSeekJump = {
		SEEK_JUMP_SEC,
		clampSeekBySeconds,
		resolveSeekByTarget,
		resolveMediaSessionDeltaSec,
		shouldHideMiniPlayer,
		resolveScrubTargetSec,
		createCommittedScrubPaint,
		bindScrubSlider,
		SCRUB_PAINT_EPSILON_MS,
		SCRUB_PAINT_TIMEOUT_MS,
		SCRUB_EOF_GUARD_SEC,
	};
})();
