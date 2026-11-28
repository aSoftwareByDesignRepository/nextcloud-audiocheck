#!/usr/bin/env node
'use strict';

/**
 * Unit + lightweight mutation gate for the scrub-slider contract in
 * AudioCheckSeekJump: resolveScrubTargetSec (absolute commit clamp + EOF
 * guard), createCommittedScrubPaint (committed-paint hold), and
 * bindScrubSlider (preview/commit split + drag latch). Runs without a
 * browser. Exit 1 on any failure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'js/common/seek-jump.js');
const src = fs.readFileSync(srcPath, 'utf8');

/** Controllable timers injected into the vm sandbox. */
function makeTimers() {
	const timers = new Map();
	let nextId = 1;
	return {
		setTimeout(fn, ms) {
			const id = nextId++;
			timers.set(id, { fn, ms });
			return id;
		},
		clearTimeout(id) { timers.delete(id); },
		fireAll() {
			for (const [id, t] of Array.from(timers)) {
				timers.delete(id);
				t.fn();
			}
		},
		pending() { return timers.size; },
	};
}

function loadApi(source, timers) {
	const t = timers || makeTimers();
	const sandbox = {
		window: {},
		console,
		setTimeout: t.setTimeout,
		clearTimeout: t.clearTimeout,
	};
	vm.runInNewContext(source, sandbox, { filename: 'seek-jump.js' });
	const api = sandbox.window.AudioCheckSeekJump;
	if (!api || typeof api.resolveScrubTargetSec !== 'function') {
		throw new Error('AudioCheckSeekJump.resolveScrubTargetSec missing');
	}
	if (typeof api.createCommittedScrubPaint !== 'function') {
		throw new Error('AudioCheckSeekJump.createCommittedScrubPaint missing');
	}
	if (typeof api.bindScrubSlider !== 'function') {
		throw new Error('AudioCheckSeekJump.bindScrubSlider missing');
	}
	return { api, timers: t };
}

/** Minimal range-input stub: listener registry + dispatch. */
function makeInput(value) {
	const listeners = {};
	return {
		value: String(value),
		listeners,
		addEventListener(type, fn) {
			(listeners[type] = listeners[type] || []).push(fn);
		},
		dispatch(type) {
			(listeners[type] || []).forEach((fn) => fn());
		},
	};
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${expected}, got ${actual}`);
	}
}

function runCases(api, timers) {
	// --- resolveScrubTargetSec ---
	const scrub = api.resolveScrubTargetSec;
	assertEqual(api.SCRUB_EOF_GUARD_SEC, 0.25, 'SCRUB_EOF_GUARD_SEC');
	assertEqual(scrub(60000, 120), 60, 'mid-track commit');
	assertEqual(scrub(0, 120), 0, 'commit to start');
	assertEqual(scrub(-5000, 120), 0, 'negative clamps to 0');
	assertEqual(scrub(Number.NaN, 120), 0, 'NaN clamps to 0');
	assertEqual(scrub(120000, 120), 119.75, 'at duration backs off EOF guard');
	assertEqual(scrub(150000, 120), 119.75, 'past duration backs off EOF guard');
	assertEqual(scrub(60000, 0), 60, 'unknown duration passes through');
	assertEqual(scrub(60000, Number.NaN), 60, 'NaN duration passes through');
	assertEqual(scrub(200, 0.1), 0, 'short track clamps to floor of guard');

	// --- createCommittedScrubPaint ---
	const paint = api.createCommittedScrubPaint();
	assertEqual(paint.paintMs(30, 1000), null, 'no commit -> no hold');
	paint.note(90000);
	// Media clock still at 30 s, epsilon 750 ms, timeout 2000 ms.
	assertEqual(paint.paintMs(30, 1000), 90000, 'held paint wins over stale clock');
	assertEqual(paint.paintMs(88, 1500), 90000, 'still held while clock approaches');
	assertEqual(paint.paintMs(89.9, 1600), null, 'converged within epsilon releases hold');
	const t0 = Date.now();
	paint.note(45000);
	assertEqual(paint.paintMs(10, t0 + 1999), 45000, 'held before timeout');
	assertEqual(paint.paintMs(10, t0 + 2000), null, 'timeout releases hold');
	paint.note(70000);
	paint.clear();
	assertEqual(paint.paintMs(5, 5000), null, 'clear releases hold immediately');

	// --- bindScrubSlider: preview/commit split + drag latch ---
	const input = makeInput(30000);
	const calls = { preview: [], commit: [], userIntent: 0 };
	const binder = api.bindScrubSlider(input, {
		preview(ms) { calls.preview.push(ms); },
		commit(ms) { calls.commit.push(ms); },
		userIntent() { calls.userIntent += 1; },
	});

	assertEqual(binder.dragging(), false, 'not dragging initially');
	input.dispatch('pointerdown');
	assertEqual(binder.dragging(), true, 'pointerdown latches drag');

	// `input` fires preview ONLY — never commit.
	input.value = '45000';
	input.dispatch('input');
	assertEqual(calls.preview.length, 1, 'input fires one preview');
	assertEqual(calls.preview[0], 45000, 'preview carries slider ms');
	assertEqual(calls.commit.length, 0, 'input must NOT commit (seek-storm guard)');
	assertEqual(calls.userIntent, 1, 'input is a user-intent signal');

	input.value = '60000';
	input.dispatch('input');
	assertEqual(calls.preview.length, 2, 'every input previews');
	assertEqual(calls.commit.length, 0, 'still no commit mid-drag');

	// pointerup alone does NOT release the latch — `change` may follow.
	input.dispatch('pointerup');
	assertEqual(binder.dragging(), true, 'latch survives pointerup until change');
	assertEqual(calls.commit.length, 0, 'pointerup does not commit');

	// `change` commits exactly once and releases the latch.
	input.dispatch('change');
	assertEqual(calls.commit.length, 1, 'change commits exactly once');
	assertEqual(calls.commit[0], 60000, 'commit carries final slider ms');
	assertEqual(binder.dragging(), false, 'change releases latch');

	// Keyboard commit: change without pointerdown still commits.
	input.value = '10000';
	input.dispatch('change');
	assertEqual(calls.commit.length, 2, 'keyboard change commits');
	assertEqual(calls.commit[1], 10000, 'keyboard commit ms');

	// pointerup with no change: latch auto-releases via the release timer.
	input.dispatch('pointerdown');
	assertEqual(binder.dragging(), true, 'drag latched again');
	input.dispatch('pointerup');
	assertEqual(binder.dragging(), true, 'still latched before release timer');
	timers.fireAll();
	assertEqual(binder.dragging(), false, 'release timer drops stale latch (no change)');

	// pointercancel releases immediately.
	input.dispatch('pointerdown');
	input.dispatch('pointercancel');
	assertEqual(binder.dragging(), false, 'pointercancel releases latch');
}

const loaded = loadApi(src);
runCases(loaded.api, loaded.timers);
console.log('scrub-slider unit OK');

function mutate(label, mutated) {
	let killed = false;
	try {
		const l = loadApi(mutated, makeTimers());
		runCases(l.api, l.timers);
	} catch (err) {
		killed = true;
	}
	if (!killed) {
		console.error(`mutation NOT killed: ${label}`);
		process.exit(1);
	}
	console.log(`scrub-slider mutation OK (${label})`);
}

// Mutation 1: drop the EOF guard — committing to duration would auto-end.
mutate('EOF guard removed', src.replace(
	'return Math.min(sec, Math.max(0, dur - SCRUB_EOF_GUARD_SEC));',
	'return Math.min(sec, dur);',
));

// Mutation 2: remove epsilon convergence — held paint never releases on
// clock convergence (only on timeout).
mutate('epsilon convergence removed', src.replace(
	'|| Math.abs(cur - committed.ms) < SCRUB_PAINT_EPSILON_MS) {',
	') {',
));

// Mutation 3: remove hold timeout — stale commit could pin paint forever.
mutate('hold timeout removed', src.replace(
	'if (now - committed.atMs >= SCRUB_PAINT_TIMEOUT_MS\n\t\t\t\t\t|| Math.abs(cur - committed.ms) < SCRUB_PAINT_EPSILON_MS) {',
	'if (Math.abs(cur - committed.ms) < SCRUB_PAINT_EPSILON_MS) {',
));

// Mutation 4: input commits directly (the original seek-storm defect).
mutate('input commits (seek storm)', src.replace(
	"input.addEventListener('input', () => {\n\t\t\tconst ms = parseInt(input.value, 10) || 0;",
	"input.addEventListener('input', () => {\n\t\t\tconst ms = parseInt(input.value, 10) || 0;\n\t\t\tif (typeof cb.commit === 'function') cb.commit(ms);",
));

// Mutation 5: pointerup releases the latch immediately — stale repaint can
// slip between release and `change`.
mutate('pointerup releases latch early', src.replace(
	'releaseTimer = setTimeout(release, 150);',
	'release();',
));

console.log('All scrub-slider gates green');
