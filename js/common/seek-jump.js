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

	window.AudioCheckSeekJump = {
		SEEK_JUMP_SEC,
		clampSeekBySeconds,
		resolveSeekByTarget,
		resolveMediaSessionDeltaSec,
		shouldHideMiniPlayer,
	};
})();
