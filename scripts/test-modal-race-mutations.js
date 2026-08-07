#!/usr/bin/env node
'use strict';

/**
 * Lightweight JS mutation gauntlet for openModal single-flight + closed guards
 * and playlistIdFrom validation (no Stryker dependency).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const root = path.join(__dirname, '..');
const componentsPath = path.join(root, 'js/common/components.js');
const playlistPath = path.join(root, 'js/common/playlist-actions.js');

function loadComponents(sourceOverride) {
	const source = sourceOverride || fs.readFileSync(componentsPath, 'utf8');
	const document = {
		body: {
			classList: { add() {}, remove() {} },
			appendChild(node) { this._child = node; },
		},
		activeElement: null,
		createElement(tag) {
			const el = {
				tagName: String(tag).toUpperCase(),
				className: '',
				children: [],
				style: {},
				attributes: {},
				disabled: false,
				open: true,
				appendChild(c) { this.children.push(c); return c; },
				setAttribute(k, v) { this.attributes[k] = String(v); },
				removeAttribute(k) { delete this.attributes[k]; },
				addEventListener() {},
				removeEventListener() {},
				querySelector() { return null; },
				focus() {},
				remove() { this.open = false; },
				close() { this.open = false; },
				showModal() { this.open = true; },
			};
			return el;
		},
		addEventListener() {},
		removeEventListener() {},
	};
	const window = { AudioCheckComponents: {}, AudioCheckMessaging: { toast() {} } };
	const sandbox = {
		window,
		document,
		t: (_a, b) => b,
		console,
		AudioCheckMessaging: window.AudioCheckMessaging,
	};
	vm.runInNewContext(source + '\nthis.AudioCheckComponents = window.AudioCheckComponents;', sandbox);
	return sandbox.window.AudioCheckComponents;
}

function testOpenModalSingleFlight() {
	const C = loadComponents();
	assert.equal(typeof C.openModal, 'function');
	let calls = 0;
	const slow = () => new Promise((resolve) => {
		calls += 1;
		setTimeout(() => resolve(true), 30);
	});
	C.openModal({
		title: 'T',
		primaryLabel: 'Go',
		cancelLabel: 'Cancel',
		render() {
			return document.createElement('div');
		},
		onSubmit: slow,
	});
	// Dig primary button from last appended dialog
	const dialog = document.body._child;
	assert.ok(dialog);
	const actions = dialog.children.find((c) => (c.className || '').includes('ac-modal__actions'))
		|| dialog.children[dialog.children.length - 1];
	const primary = actions.children[actions.children.length - 1];
	assert.ok(primary);
	const click = primary._listeners && primary._listeners.click
		? primary._listeners.click[0]
		: null;
	// Our createElement stub does not store listeners — re-load with instrumented createElement.
}

/** Instrumented load that records click handlers */
function loadComponentsInstrumented(sourceText) {
	const listeners = new WeakMap();
	const document = {
		body: {
			classList: { add() {}, remove() {} },
			appendChild(node) { this._child = node; return node; },
		},
		activeElement: null,
		createElement(tag) {
			const el = {
				tagName: String(tag).toUpperCase(),
				className: '',
				children: [],
				style: {},
				attributes: {},
				disabled: false,
				open: true,
				appendChild(c) { this.children.push(c); return c; },
				setAttribute(k, v) { this.attributes[k] = String(v); },
				removeAttribute(k) { delete this.attributes[k]; },
				addEventListener(type, fn) {
					if (!this._on) this._on = {};
					if (!this._on[type]) this._on[type] = [];
					this._on[type].push(fn);
				},
				removeEventListener() {},
				querySelector() { return null; },
				focus() {},
				remove() { this.open = false; },
				close() { this.open = false; },
				showModal() { this.open = true; },
			};
			return el;
		},
		addEventListener() {},
		removeEventListener() {},
	};
	const window = { AudioCheckComponents: {}, AudioCheckMessaging: { toast() {} } };
	const sandbox = {
		window,
		document,
		t: (_a, b) => b,
		console,
		AudioCheckMessaging: window.AudioCheckMessaging,
		setTimeout,
		clearTimeout,
	};
	vm.runInNewContext(sourceText + '\nthis.AudioCheckComponents = window.AudioCheckComponents;', sandbox);
	return { C: sandbox.window.AudioCheckComponents, document };
}

async function assertSingleFlight() {
	const source = fs.readFileSync(componentsPath, 'utf8');
	const { C, document } = loadComponentsInstrumented(source);
	let calls = 0;
	C.openModal({
		title: 'T',
		primaryLabel: 'Go',
		cancelLabel: 'Cancel',
		render() { return document.createElement('div'); },
		onSubmit: () => {
			calls += 1;
			return new Promise((r) => setTimeout(() => r(true), 40));
		},
	});
	const dialog = document.body._child;
	const actions = dialog.children[dialog.children.length - 1];
	const primary = actions.children[actions.children.length - 1];
	const handlers = primary._on.click;
	assert.ok(handlers && handlers.length === 1);
	await Promise.all([handlers[0](), handlers[0]()]);
	assert.strictEqual(calls, 1, 'openModal must single-flight primary submit');
}

function assertClosedIdempotent() {
	const source = fs.readFileSync(componentsPath, 'utf8');
	const { C, document } = loadComponentsInstrumented(source);
	let cancelCount = 0;
	const instance = C.openModal({
		title: 'T',
		render() { return document.createElement('div'); },
		onCancel: () => { cancelCount += 1; },
	});
	instance.close(false);
	instance.close(false);
	assert.strictEqual(cancelCount, 1, 'close must be idempotent');
}

function assertPlaylistIdHelperSurvivesInSource() {
	const src = fs.readFileSync(playlistPath, 'utf8');
	assert.ok(src.includes('function playlistIdFrom'), 'playlistIdFrom must exist');
	assert.ok(src.includes('Number.isFinite(id) && id >= 1'), 'playlistIdFrom must reject invalid ids');
	assert.ok(src.includes('AbortController'), 'add-to-playlist must abort on close');
	assert.ok(src.includes('onClose:'), 'openModal onClose must abort work');
	assert.ok(src.includes('onSubmit: async'), 'build playlist must await submit');
	assert.ok(!/return true;\s*\n\s*\},\s*\n\s*\}\);/.test(src.split('openBuildPlaylistFromCollection')[1].slice(0, 800))
		|| src.includes('await AudioCheckApi.post(\'/apps/audiocheck/api/playlists/build\''),
		'build must await API');
}

async function main() {
	await assertSingleFlight();
	assertClosedIdempotent();
	assertPlaylistIdHelperSurvivesInSource();

	// Mutation: remove submitting guard — must fail single-flight test
	const original = fs.readFileSync(componentsPath, 'utf8');
	const mutated = original.replace('if (closed || submitting) return;', 'if (closed) return;');
	assert.notStrictEqual(mutated, original, 'mutation anchor for submitting guard');
	const tmp = componentsPath + '.mutation-tmp.js';
	try {
		// Run single-flight against mutated source in-memory
		const { C, document } = loadComponentsInstrumented(mutated);
		let calls = 0;
		C.openModal({
			title: 'T',
			primaryLabel: 'Go',
			cancelLabel: 'Cancel',
			render() { return document.createElement('div'); },
			onSubmit: () => {
				calls += 1;
				return new Promise((r) => setTimeout(() => r(false), 40));
			},
		});
		const dialog = document.body._child;
		const actions = dialog.children[dialog.children.length - 1];
		const primary = actions.children[actions.children.length - 1];
		await Promise.all([primary._on.click[0](), primary._on.click[0]()]);
		assert.ok(calls >= 2, 'mutated openModal must allow double submit (proves test kills guard removal)');
	} finally {
		if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
	}

	console.log('JS modal/playlist race mutations OK');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
