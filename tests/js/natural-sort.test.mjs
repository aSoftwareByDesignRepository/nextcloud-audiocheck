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
