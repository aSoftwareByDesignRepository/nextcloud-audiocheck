(function () {
	'use strict';

	// Natural ("human") ordering — parity mirror of
	// lib/Util/NaturalSort.php (server) and src/utils/naturalSort.ts (mobile).
	// Numeric runs compare by value ("1" < "2" < "10"); text runs compare
	// accent-folded, case-insensitive. Parity corpus lives in
	// tests/js/natural-sort.test.mjs and must stay identical across all three.
	const DIGITS = /^\d+$/;

	function stripAccents(value) {
		return String(value)
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/ß/g, 'ss')
			.replace(/ẞ/g, 'SS')
			.toLowerCase();
	}

	function tokens(input) {
		const norm = stripAccents(input.trim());
		if (norm === '') return [{ num: false, value: '' }];
		const parts = norm.match(/\d+|\D+/g) || [norm];
		return parts.map((p) => ({ num: DIGITS.test(p), value: p }));
	}

	function compareToken(a, b) {
		if (a.num && b.num) {
			const an = a.value.replace(/^0+/, '') || '0';
			const bn = b.value.replace(/^0+/, '') || '0';
			if (an.length !== bn.length) return an.length < bn.length ? -1 : 1;
			const cmp = an < bn ? -1 : an > bn ? 1 : 0;
			if (cmp !== 0) return cmp;
			// Same value — fewer leading zeros first ("1" < "01" < "001").
			if (a.value.length !== b.value.length) return a.value.length - b.value.length;
		}
		return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
	}

	function naturalCompare(a, b) {
		const sa = a == null ? '' : String(a);
		const sb = b == null ? '' : String(b);
		if (sa === sb) return 0;
		const ta = tokens(sa);
		const tb = tokens(sb);
		const count = Math.max(ta.length, tb.length);
		for (let i = 0; i < count; i++) {
			const x = ta[i];
			const y = tb[i];
			if (x === undefined) return -1;
			if (y === undefined) return 1;
			const cmp = compareToken(x, y);
			if (cmp !== 0) return cmp;
		}
		return sa < sb ? -1 : sa > sb ? 1 : 0;
	}

	/**
	 * Shared comparator core for playlist items and queue tracks — parity with
	 * PlaylistService::SORT_MODES. `idOf` supplies the deterministic tiebreak
	 * (playlist item id vs. queue track fileId).
	 * @param {string} mode
	 * @param {(item: object) => (number|undefined)} idOf
	 */
	function trackLikeComparator(mode, idOf) {
		const byTrack = mode.indexOf('track') === 0;
		return (a, b) => {
			let cmp = 0;
			if (byTrack) {
				const da = a.discNo != null ? a.discNo : 0;
				const db = b.discNo != null ? b.discNo : 0;
				cmp = da - db;
				if (cmp === 0) {
					const ta = a.trackNo != null ? a.trackNo : null;
					const tb = b.trackNo != null ? b.trackNo : null;
					if (ta !== null && tb !== null && ta !== tb) cmp = ta - tb;
					else if ((ta === null) !== (tb === null)) cmp = ta !== null ? -1 : 1;
				}
			}
			if (cmp === 0) {
				cmp = naturalCompare(
					a.title || a.fileName || '',
					b.title || b.fileName || '',
				);
				if (cmp === 0) cmp = (idOf(a) || 0) - (idOf(b) || 0);
			}
			return cmp;
		};
	}

	function sortTrackLike(items, mode, idOf) {
		const list = (items || []).slice();
		if (!mode || mode === 'manual') return list;
		const desc = mode.endsWith('_desc');
		list.sort(trackLikeComparator(mode, idOf));
		return desc ? list.reverse() : list;
	}

	/**
	 * Sort playlist items by a persisted mode — parity with
	 * PlaylistService::SORT_MODES. 'manual' keeps the stored order.
	 * @param {Array<object>} items
	 * @param {string} mode
	 */
	function sortPlaylistItems(items, mode) {
		return sortTrackLike(items, mode, (item) => item.id);
	}

	/** Modes a live queue can be sorted by — 'manual' does not exist here. */
	const QUEUE_SORT_MODES = ['name', 'name_desc', 'track', 'track_desc'];

	/**
	 * Sort queue tracks by mode — same ordering semantics as
	 * {@see sortPlaylistItems} but tiebreaks on fileId (queue entries have no
	 * playlist item id).
	 * @param {Array<object>} items
	 * @param {string} mode
	 */
	function sortQueueTracks(items, mode) {
		return sortTrackLike(items, mode, (item) => item.fileId);
	}

	/**
	 * Which sort mode the current item order equals, if any — element-identity
	 * comparison so duplicate fileIds cannot produce a false match. First
	 * matching mode in QUEUE_SORT_MODES order wins when orders coincide.
	 * @param {Array<object>} items
	 * @returns {?string}
	 */
	function queueSortModeFor(items) {
		if (!items || items.length < 2) return null;
		for (const mode of QUEUE_SORT_MODES) {
			const sorted = sortQueueTracks(items, mode);
			let same = sorted.length === items.length;
			for (let i = 0; same && i < items.length; i++) {
				if (sorted[i] !== items[i]) same = false;
			}
			if (same) return mode;
		}
		return null;
	}

	window.AudioCheckNaturalSort = {
		naturalCompare,
		sortPlaylistItems,
		sortQueueTracks,
		queueSortModeFor,
		QUEUE_SORT_MODES,
	};
})();
