#!/usr/bin/env node
/**
 * Behavioural tests for audiocheck js/common/messaging.js.
 *
 * Locks the toast contract fixed in the ds_chrome lane:
 *  - toasts always render the app-owned .ac-toast pipeline (never delegate to
 *    OC.Notification/toastify, which would bypass dedup + report link)
 *  - identical kind+text toasts dedup with timer reset (no stacking)
 *  - error toasts carry the "Report this problem" mailto link via
 *    SbdAppFeedback.buildMailto (dead-hook class: the shared app-feedback
 *    wrapper only covers {App}Components.showToast/showError)
 *
 * Run: node tests/js/messaging.test.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'common', 'messaging.js'), 'utf8');

let failures = 0;
function assert(cond, msg) {
	if (!cond) {
		failures += 1;
		process.stderr.write('FAIL: ' + msg + '\n');
	}
}

/* Minimal DOM stub: enough for ensureToastContainer + showToast + announce. */
function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		children: [],
		dataset: {},
		attrs: {},
		parentNode: null,
		id: '',
		className: '',
		textContent: '',
		appendChild(child) {
			child.parentNode = el;
			el.children.push(child);
			return child;
		},
		removeChild(child) {
			const i = el.children.indexOf(child);
			if (i >= 0) el.children.splice(i, 1);
			child.parentNode = null;
			return child;
		},
		remove() {
			if (el.parentNode) el.parentNode.removeChild(el);
		},
		setAttribute(k, v) {
			el.attrs[k] = String(v);
		},
		getAttribute(k) {
			return el.attrs[k] !== undefined ? el.attrs[k] : null;
		},
		addEventListener() {},
		querySelectorAll() {
			return [];
		},
	};
	return el;
}

function boot() {
	const byId = new Map();
	const body = makeEl('body');
	function findById(node, id) {
		if (node.id === id) return node;
		for (const c of node.children) {
			const hit = findById(c, id);
			if (hit) return hit;
		}
		return null;
	}
	const doc = {
		readyState: 'complete',
		body,
		getElementById(id) {
			return byId.get(id) || findById(body, id);
		},
		createElement(tag) {
			return makeEl(tag);
		},
	};
	// Expose byId so the harness can seed live regions.
	const ocCalls = [];
	const sandbox = {
		document: doc,
		t(app, key) {
			return key;
		},
		SbdAppFeedback: {
			buildMailto(kind) {
				return 'mailto:dev@software-by-design.de?subject=' + encodeURIComponent('AudioCheck: Problem report');
			},
		},
		OC: {
			Notification: {
				showTemporary(message, options) {
					ocCalls.push({ message, options });
				},
			},
		},
		setTimeout: (fn, ms) => ({ fn, ms }),
		clearTimeout: () => {},
	};
	sandbox.window = sandbox;
	vm.runInNewContext(SRC, sandbox, { filename: 'messaging.js' });
	return { sandbox, doc, body, byId, ocCalls };
}

function main() {
	const { sandbox, doc, byId, ocCalls } = boot();
	const M = sandbox.AudioCheckMessaging;
	assert(M && typeof M.toast === 'function', 'AudioCheckMessaging.toast exported');
	assert(typeof M.announce === 'function', 'AudioCheckMessaging.announce exported');

	// Error toast renders own pipeline even though OC.Notification exists.
	M.toast('Save failed', 'error');
	assert(ocCalls.length === 0, 'OC.Notification.showTemporary never called (dead toastify path removed)');
	const container = doc.getElementById('ac-toasts');
	assert(container && container.className === 'ac-toasts', 'toast container created');
	assert(container.children.length === 1, 'one toast rendered');
	const toast = container.children[0];
	assert(toast.className.includes('ac-toast--error'), 'error toast carries ac-toast--error');
	assert(toast.getAttribute('role') === 'alert', 'error toast role=alert');
	const link = toast.children.find((c) => c.tagName === 'A');
	assert(!!link, 'error toast carries a report link');
	assert(link && /^mailto:dev@software-by-design\.de/.test(link.href || link.attrs.href || ''), 'report link is the family mailto');
	assert(link && String(link.className).includes('ac-nav-footer__toast-link'), 'report link uses synced nav-footer__toast-link class');
	assert(link && link.textContent === 'Report this problem', 'report link label');
	const label = toast.children.find((c) => c.tagName === 'SPAN');
	assert(label && label.textContent === 'Save failed', 'toast text rendered');

	// Dedup: identical kind+text resets timer instead of stacking.
	M.toast('Save failed', 'error');
	assert(container.children.length === 1, 'identical error toast deduped (no stacking)');
	M.toast('Save failed', 'warning');
	assert(container.children.length === 2, 'different kind = separate toast');
	M.toast('Other failure', 'error');
	assert(container.children.length === 3, 'different text = separate toast');

	// Non-error kinds carry no report link.
	const warn = container.children[1];
	assert(!warn.children.some((c) => c.tagName === 'A'), 'warning toast has no report link');

	// Announce writes errors to the assertive region.
	const assertive = makeEl('div');
	byId.set('ac-alert-region', assertive);
	M.announce('Boom', 'error');
	assert(typeof assertive.textContent === 'string', 'assertive announce writes textContent');

	// Without SbdAppFeedback the toast still renders (best-effort link).
	const bare = boot();
	bare.sandbox.SbdAppFeedback = undefined;
	bare.sandbox.AudioCheckMessaging.toast('No helper', 'error');
	const bareToast = bare.doc.getElementById('ac-toasts').children[0];
	assert(bareToast.className.includes('ac-toast--error'), 'error toast renders without helper');
	assert(!bareToast.children.some((c) => c.tagName === 'A'), 'no report link when helper missing');

	if (failures > 0) {
		process.stderr.write('\n' + failures + ' failure(s)\n');
		process.exit(1);
	}
	process.stdout.write('messaging.test.cjs OK (audiocheck)\n');
}

main();
