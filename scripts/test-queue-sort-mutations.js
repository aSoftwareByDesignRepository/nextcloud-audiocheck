#!/usr/bin/env node
/**
 * Mutation gate for the queue-sort helpers in js/common/natural-sort.js —
 * proves the unit suite kills broken ordering semantics (desc reversal,
 * trackNo null-last leg, fileId tiebreak, mode detection).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'common', 'natural-sort.js');
const original = fs.readFileSync(SRC, 'utf8');

function runTests() {
	return spawnSync('node', ['--test', 'tests/js/natural-sort.test.mjs'], {
		cwd: ROOT,
		encoding: 'utf8',
	});
}

function fail(msg) {
	fs.writeFileSync(SRC, original);
	console.error(msg);
	process.exit(1);
}

const baseline = runTests();
if (baseline.status !== 0) {
	fail(`baseline natural-sort tests failed:\n${baseline.stdout}\n${baseline.stderr}`);
}
console.log('natural-sort baseline OK');

const mutants = [
	{
		name: 'drop-desc-reversal',
		apply: (s) => s.replace('return desc ? list.reverse() : list;', 'return list;'),
	},
	{
		name: 'drop-trackno-null-last',
		apply: (s) => s.replace(
			"else if ((ta === null) !== (tb === null)) cmp = ta !== null ? -1 : 1;",
			'',
		),
	},
	{
		name: 'drop-fileid-tiebreak',
		apply: (s) => s.replace('cmp = (idOf(a) || 0) - (idOf(b) || 0);', 'cmp = 0;'),
	},
	{
		name: 'queue-mode-for-returns-first',
		apply: (s) => s.replace('if (same) return mode;', 'if (same) return QUEUE_SORT_MODES[0];'),
	},
	{
		name: 'inverted-disc-compare',
		apply: (s) => s.replace('cmp = da - db;', 'cmp = db - da;'),
	},
];

for (const mutant of mutants) {
	const mutated = mutant.apply(original);
	if (mutated === original) {
		fail(`mutant ${mutant.name} did not change source`);
	}
	fs.writeFileSync(SRC, mutated);
	const result = runTests();
	fs.writeFileSync(SRC, original);
	if (result.status === 0) {
		fail(`mutant ${mutant.name} was NOT killed`);
	}
	console.log(`killed ${mutant.name}`);
}

fs.writeFileSync(SRC, original);
console.log('queue-sort mutation gate OK');
