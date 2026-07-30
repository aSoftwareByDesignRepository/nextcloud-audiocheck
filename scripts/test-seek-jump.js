#!/usr/bin/env node
'use strict';

/**
 * Unit + lightweight mutation gate for AudioCheckSeekJump.clampSeekBySeconds.
 * Runs without a browser. Exit 1 on any failure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'js/common/seek-jump.js');
const src = fs.readFileSync(srcPath, 'utf8');

function loadClamp(source) {
	const sandbox = { window: {}, console };
	vm.runInNewContext(source, sandbox, { filename: 'seek-jump.js' });
	const api = sandbox.window.AudioCheckSeekJump;
	if (!api || typeof api.clampSeekBySeconds !== 'function') {
		throw new Error('AudioCheckSeekJump.clampSeekBySeconds missing');
	}
	if (typeof api.resolveSeekByTarget !== 'function') {
		throw new Error('AudioCheckSeekJump.resolveSeekByTarget missing');
	}
	if (typeof api.resolveMediaSessionDeltaSec !== 'function') {
		throw new Error('AudioCheckSeekJump.resolveMediaSessionDeltaSec missing');
	}
	return api;
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${expected}, got ${actual}`);
	}
}

function runCases(api) {
	const clamp = api.clampSeekBySeconds;
	assertEqual(api.SEEK_JUMP_SEC, 30, 'SEEK_JUMP_SEC');
	assertEqual(clamp(10, 30, 120), 40, 'forward mid');
	assertEqual(clamp(40, -30, 120), 10, 'back mid');
	assertEqual(clamp(5, -30, 120), 0, 'clamp back to 0');
	assertEqual(clamp(110, 30, 120), 120, 'clamp forward to duration');
	assertEqual(clamp(0, -30, 120), 0, 'at zero back stays zero');
	assertEqual(clamp(120, 30, 120), 120, 'at end forward stays end');
	assertEqual(clamp(10, 30, 0), 40, 'unknown duration allows forward');
	assertEqual(clamp(Number.NaN, 30, 120), 30, 'NaN position treated as 0');
	assertEqual(clamp(10, Number.NaN, 120), 10, 'NaN delta treated as 0');
	const rapid = api.resolveSeekByTarget({
		pendingTargetSec: null,
		positionSec: 60,
		deltaSec: -30,
		durationSec: 120,
	});
	assertEqual(rapid.nextSec, 30, 'rapid first jump');
	const rapid2 = api.resolveSeekByTarget({
		pendingTargetSec: rapid.pendingTargetSec,
		positionSec: 60,
		deltaSec: -30,
		durationSec: 120,
	});
	assertEqual(rapid2.nextSec, 0, 'rapid second jump accumulates despite stale clock');
	assertEqual(
		api.resolveMediaSessionDeltaSec({ seekOffset: 10 }, api.SEEK_JUMP_SEC),
		30,
		'MediaSession ignores UA 10s offset',
	);
	assertEqual(
		api.resolveMediaSessionDeltaSec(undefined, api.SEEK_JUMP_SEC),
		30,
		'MediaSession falls back to locked interval',
	);
	assertEqual(
		api.resolveMediaSessionDeltaSec(null, Number.NaN),
		30,
		'MediaSession rejects invalid lockedSec',
	);
}

const api = loadClamp(src);
runCases(api);
console.log('seek-jump unit OK');

// Mutation: remove clamp-to-zero — must fail the "clamp back to 0" case.
const mutantNoFloor = src.replace(
	'if (next < 0) next = 0;',
	'/* mutated: no floor */',
);
let killed = false;
try {
	runCases(loadClamp(mutantNoFloor));
} catch (err) {
	killed = true;
}
if (!killed) {
	console.error('mutation NOT killed: floor clamp removed but tests still passed');
	process.exit(1);
}
console.log('seek-jump mutation OK (floor clamp)');

// Mutation: remove duration ceiling — must fail.
const mutantNoCeil = src.replace(
	'if (dur > 0 && next > dur) next = dur;',
	'/* mutated: no ceiling */',
);
killed = false;
try {
	runCases(loadClamp(mutantNoCeil));
} catch (err) {
	killed = true;
}
if (!killed) {
	console.error('mutation NOT killed: ceiling clamp removed but tests still passed');
	process.exit(1);
}
console.log('seek-jump mutation OK (ceiling clamp)');

// Mutation: change default interval — must fail.
const mutantInterval = src.replace('const SEEK_JUMP_SEC = 30;', 'const SEEK_JUMP_SEC = 15;');
killed = false;
try {
	runCases(loadClamp(mutantInterval));
} catch (err) {
	killed = true;
}
if (!killed) {
	console.error('mutation NOT killed: SEEK_JUMP_SEC changed to 15 but tests still passed');
	process.exit(1);
}
console.log('seek-jump mutation OK (interval)');

// Mutation: ignore pending target (rapid-tap race regression) — must fail.
const mutantIgnorePending = src.replace(
	'const base = pending != null && Number.isFinite(pending) ? pending : params.positionSec;',
	'const base = params.positionSec;',
);
killed = false;
try {
	runCases(loadClamp(mutantIgnorePending));
} catch (err) {
	killed = true;
}
if (!killed) {
	console.error('mutation NOT killed: pending target ignored but tests still passed');
	process.exit(1);
}
console.log('seek-jump mutation OK (pending target)');

// Mutation: honour UA MediaSession seekOffset (often 10) — must fail hard-lock contract.
const mutantHonorUaOffset = src.replace(
	'function resolveMediaSessionDeltaSec(_details, lockedSec) {\n\t\tconst locked = Number(lockedSec);\n\t\treturn Number.isFinite(locked) && locked > 0 ? locked : SEEK_JUMP_SEC;\n\t}',
	'function resolveMediaSessionDeltaSec(details, lockedSec) {\n\t\tconst fromUa = details && Number(details.seekOffset);\n\t\tif (Number.isFinite(fromUa) && fromUa > 0) return fromUa;\n\t\tconst locked = Number(lockedSec);\n\t\treturn Number.isFinite(locked) && locked > 0 ? locked : SEEK_JUMP_SEC;\n\t}',
);
killed = false;
try {
	runCases(loadClamp(mutantHonorUaOffset));
} catch (err) {
	killed = true;
}
if (!killed) {
	console.error('mutation NOT killed: MediaSession UA seekOffset honoured but tests still passed');
	process.exit(1);
}
console.log('seek-jump mutation OK (media session hard-lock)');
console.log('All seek-jump gates green');
