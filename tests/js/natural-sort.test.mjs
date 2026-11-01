import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'common', 'natural-sort.js'), 'utf8');

function load() {
	const sandbox = { window: {}, Intl };
	vm.createContext(sandbox);
	vm.runInContext(SRC, sandbox);
	return sandbox.window.AudioCheckNaturalSort;
}

/**
 * Parity corpus — must stay identical with tests/Unit/Util/NaturalSortTest.php
 * (PHP) and src/__tests__/naturalSort.test.ts (mobile). Any divergence is a bug.
 */
const CORPUS = [
	{ input: ['10.mp3', '2.mp3', '1.mp3', '11.mp3', '20.mp3'], expected: ['1.mp3', '2.mp3', '10.mp3', '11.mp3', '20.mp3'] },
	{ input: ['10.mp3', '01.mp3', '002.mp3', '1.mp3'], expected: ['1.mp3', '01.mp3', '002.mp3', '10.mp3'] },
	{ input: ['Kapitel 10', 'Kapitel 2', 'Kapitel 01'], expected: ['Kapitel 01', 'Kapitel 2', 'Kapitel 10'] },
	{ input: ['CD10 - x', 'CD2 - x', 'CD1 - x'], expected: ['CD1 - x', 'CD2 - x', 'CD10 - x'] },
	{ input: ['Teil 3b', 'Teil 10a', 'Teil 2a'], expected: ['Teil 2a', 'Teil 3b', 'Teil 10a'] },
	{ input: ['1b', '10a', '1a'], expected: ['1a', '1b', '10a'] },
	{ input: ['b', '', 'a'], expected: ['', 'a', 'b'] },
	{ input: ['01', '1', '001'], expected: ['1', '01', '001'] },
	{ input: ['x99999999999999999999', 'x100000000000000000000'], expected: ['x99999999999999999999', 'x100000000000000000000'] },
];

test('naturalSortCompare parity corpus', (t) => {
	const { naturalCompare } = load();
	for (const c of CORPUS) {
		const got = c.input.slice().sort(naturalCompare);
		assert.deepEqual(got, c.expected, `orders ${JSON.stringify(c.input)}`);
	}
});

test('naturalSortCompare is deterministic and antisymmetric', () => {
	const { naturalCompare } = load();
	for (const c of CORPUS) {
		for (const a of c.input) {
			for (const b of c.input) {
				const ab = naturalCompare(a, b);
				const ba = naturalCompare(b, a);
				assert.ok(ab === 0 ? ba === 0 : ab === -ba, `${a} vs ${b}`);
				assert.equal(ab, naturalCompare(a, b));
			}
		}
	}
});

test('sortPlaylistItems: manual keeps stored order', () => {
	const { sortPlaylistItems } = load();
	const items = [{ id: 1, title: 'B' }, { id: 2, title: 'A' }];
	assert.deepEqual(sortPlaylistItems(items, 'manual'), items);
	assert.deepEqual(sortPlaylistItems(items, undefined), items);
});

test('sortPlaylistItems: name modes use natural ordering, desc reverses', () => {
	const { sortPlaylistItems } = load();
	const items = [
		{ id: 1, title: 'Ch. 10' },
		{ id: 2, title: 'Ch. 2' },
		{ id: 3, title: 'Ch. 1' },
	];
	assert.deepEqual(sortPlaylistItems(items, 'name').map((i) => i.title), ['Ch. 1', 'Ch. 2', 'Ch. 10']);
	assert.deepEqual(sortPlaylistItems(items, 'name_desc').map((i) => i.title), ['Ch. 10', 'Ch. 2', 'Ch. 1']);
});

test('sortPlaylistItems: track mode honors disc then trackNo, nulls last', () => {
	const { sortPlaylistItems } = load();
	const items = [
		{ id: 1, title: 'a', discNo: 2, trackNo: 1 },
		{ id: 2, title: 'b', discNo: 1, trackNo: null },
		{ id: 3, title: 'c', discNo: 1, trackNo: 3 },
		{ id: 4, title: 'd', discNo: 1, trackNo: 1 },
	];
	assert.deepEqual(sortPlaylistItems(items, 'track').map((i) => i.id), [4, 3, 2, 1]);
	assert.deepEqual(sortPlaylistItems(items, 'track_desc').map((i) => i.id), [1, 2, 3, 4]);
});

test('sortPlaylistItems: equal trackNo on same disc falls back to title (PHP parity)', (t) => {
	const { sortPlaylistItems } = load();
	// Same disc + same trackNo must not pick an arbitrary winner — the title
	// tiebreak decides, exactly like PlaylistService::sortItems (cmp stays 0).
	const items = [
		{ id: 1, title: 'Zulu', discNo: 1, trackNo: 3 },
		{ id: 2, title: 'Alpha', discNo: 1, trackNo: 3 },
	];
	assert.deepEqual(sortPlaylistItems(items, 'track').map((i) => i.id), [2, 1]);
});

test('sortQueueTracks: fileId tiebreak replaces playlist item id', () => {
	const { sortQueueTracks } = load();
	const items = [
		{ fileId: 90, title: 'Same', trackNo: 1 },
		{ fileId: 7, title: 'Same', trackNo: 1 },
	];
	// Identical sort keys → stable id order, never engine-dependent.
	assert.deepEqual(sortQueueTracks(items, 'track').map((i) => i.fileId), [7, 90]);
	assert.deepEqual(sortQueueTracks(items, 'track_desc').map((i) => i.fileId), [90, 7]);
});

test('sortQueueTracks: manual and unknown modes keep order, input not mutated', () => {
	const { sortQueueTracks } = load();
	const items = [{ fileId: 2, title: 'B' }, { fileId: 1, title: 'A' }];
	assert.deepEqual(sortQueueTracks(items, 'manual').map((i) => i.fileId), [2, 1]);
	assert.deepEqual(sortQueueTracks(items, 'bogus').map((i) => i.fileId), [1, 2]);
	assert.deepEqual(items.map((i) => i.fileId), [2, 1], 'input array must not be mutated');
});

test('sortQueueTracks: null disc/track fall back to name (degraded payload)', () => {
	const { sortQueueTracks } = load();
	// Queue items that never carried disc/track metadata must still produce a
	// deterministic order — disc collapses to name compare, never throws.
	const items = [
		{ fileId: 1, title: 'Zulu' },
		{ fileId: 2, title: 'Alpha' },
	];
	assert.deepEqual(sortQueueTracks(items, 'track').map((i) => i.fileId), [2, 1]);
});

test('queueSortModeFor: detects each matching order, null for custom', () => {
	const { queueSortModeFor, sortQueueTracks } = load();
	const items = [
		{ fileId: 1, title: 'Ch. 10' },
		{ fileId: 2, title: 'Ch. 2' },
		{ fileId: 3, title: 'Ch. 1' },
	];
	for (const mode of ['name', 'name_desc']) {
		const sorted = sortQueueTracks(items, mode);
		assert.equal(queueSortModeFor(sorted), mode, `order produced by ${mode}`);
	}
	// Track order must differ from every name order or 'name'/'name_desc'
	// legitimately wins the first-match check.
	const numbered = [
		{ fileId: 1, title: 'Alpha', trackNo: 2 },
		{ fileId: 2, title: 'Zulu', trackNo: 1 },
		{ fileId: 3, title: 'Mike', trackNo: 3 },
	];
	assert.equal(queueSortModeFor(sortQueueTracks(numbered, 'track')), 'track');
	assert.equal(queueSortModeFor(sortQueueTracks(numbered, 'track_desc')), 'track_desc');
	// No track metadata → track sort collapses to name order; 'name' wins
	// first-match — the derived chip reports the order the list IS in.
	assert.equal(queueSortModeFor(sortQueueTracks(items, 'track')), 'name');
	assert.equal(queueSortModeFor([{ fileId: 2, title: 'Z' }, { fileId: 1, title: 'A' }]), 'name_desc');
	// Three items can sit in an order no mode produces → custom order.
	const custom = [
		{ fileId: 1, title: 'Zulu' },
		{ fileId: 2, title: 'Alpha' },
		{ fileId: 3, title: 'Mike' },
	];
	assert.equal(queueSortModeFor(custom), null);
});

test('queueSortModeFor: degenerate sizes and duplicate fileIds', () => {
	const { queueSortModeFor } = load();
	assert.equal(queueSortModeFor([]), null);
	assert.equal(queueSortModeFor([{ fileId: 1, title: 'A' }]), null);
	assert.equal(queueSortModeFor(undefined), null);
	// Same element twice — element identity must not confuse the matcher.
	const dup = { fileId: 9, title: 'Same' };
	assert.equal(queueSortModeFor([dup, dup]), 'name');
});
