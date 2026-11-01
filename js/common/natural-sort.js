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
	 * Sort playlist items by a persisted mode — parity with
	 * PlaylistService::SORT_MODES. 'manual' keeps the stored order.
	 * @param {Array<object>} items
	 * @param {string} mode
	 */
	function sortPlaylistItems(items, mode) {
		const list = (items || []).slice();
		if (!mode || mode === 'manual') return list;
		const desc = mode.endsWith('_desc');
		const byTrack = mode.indexOf('track') === 0;
		list.sort((a, b) => {
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
				if (cmp === 0) cmp = (a.id || 0) - (b.id || 0);
			}
			return cmp;
		});
		return desc ? list.reverse() : list;
	}

	window.AudioCheckNaturalSort = { naturalCompare, sortPlaylistItems };
})();
