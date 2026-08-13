/**
 * Unit tests for App settings sidebar expand/collapse sync.
 * Proves the submenu is not permanently expanded (CSS+JS contract).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routerSrc = readFileSync(path.join(appRoot, 'js/common/router.js'), 'utf8');
const appCss = readFileSync(path.join(appRoot, 'css/app.css'), 'utf8');
const patternsCss = readFileSync(path.join(appRoot, 'css/common/page-patterns.css'), 'utf8');

function makeNavParent({ expanded = false } = {}) {
	const classList = {
		_set: new Set(expanded ? ['ac-nav__item', 'ac-nav__item--has-children', 'is-expanded'] : ['ac-nav__item', 'ac-nav__item--has-children']),
		toggle(name, force) {
			if (force) this._set.add(name);
			else this._set.delete(name);
		},
		contains(name) {
			return this._set.has(name);
		},
	};
	const attrs = {
		'aria-expanded': expanded ? 'true' : 'false',
	};
	const kidsAttrs = {};
	if (!expanded) kidsAttrs.hidden = '';
	const kids = {
		className: 'ac-nav__children',
		attributes: kidsAttrs,
		get hidden() {
			return Object.prototype.hasOwnProperty.call(this.attributes, 'hidden');
		},
		set hidden(v) {
			if (v) this.attributes.hidden = '';
			else delete this.attributes.hidden;
		},
		getAttribute(k) {
			return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
		},
		hasAttribute(k) {
			return Object.prototype.hasOwnProperty.call(this.attributes, k);
		},
	};
	const link = {
		className: 'ac-nav__link',
		attributes: attrs,
		setAttribute(k, v) {
			this.attributes[k] = String(v);
		},
		getAttribute(k) {
			return this.attributes[k] ?? null;
		},
		classList: { toggle() {}, contains() { return false; } },
		removeAttribute() {},
	};
	const li = {
		classList,
		attributes: { 'data-ac-nav-id': 'app-settings' },
		getAttribute(k) {
			return this.attributes[k] ?? null;
		},
		querySelector(sel) {
			if (sel === ':scope > .ac-nav__link' || sel === '.ac-nav__link') return link;
			if (sel === ':scope > .ac-nav__children' || sel === '.ac-nav__children') return kids;
			return null;
		},
		_link: link,
		_kids: kids,
	};
	return li;
}

function loadRouter() {
	const sandbox = {
		window: {},
		document: {
			querySelectorAll() { return []; },
			getElementById() { return null; },
			dispatchEvent() {},
		},
		history: { pushState() {} },
		location: { pathname: '/apps/audiocheck/' },
		OC: { generateUrl: (p) => p },
		CustomEvent: class CustomEvent {
			constructor(type, init) {
				this.type = type;
				this.detail = init && init.detail;
			}
		},
		AudioCheckConstants: { FAVORITES_PLAYLIST_ID: 'favorites' },
		AudioCheckMobileNav: { close() {} },
		AudioCheckPageChrome: null,
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;
	vm.runInNewContext(routerSrc, sandbox);
	return sandbox.window.AudioCheckRouter;
}

test('CSS forces nav children [hidden] to display:none under #app-navigation', () => {
	assert.match(
		appCss,
		/#app-navigation\.ac-nav\s+\.ac-nav__children\[hidden\][\s\S]*?display:\s*none\s*!important/,
	);
	assert.match(
		appCss,
		/#app-navigation\.ac-nav\s+\.ac-nav__item--has-children:not\(\.is-expanded\)\s*>\s*\.ac-nav__children[\s\S]*?display:\s*none\s*!important/,
	);
	assert.doesNotMatch(
		patternsCss,
		/#app-content\.ac-app\s+\.ac-nav__children\[hidden\]/,
		'wrong scope must not reappear',
	);
});

test('syncAppSettingsNavExpansion collapses off settings and expands on settings', () => {
	const router = loadRouter();
	assert.equal(typeof router.syncAppSettingsNavExpansion, 'function');

	const li = makeNavParent({ expanded: true });
	assert.equal(router.syncAppSettingsNavExpansion(li, false), false);
	assert.equal(li.classList.contains('is-expanded'), false);
	assert.equal(li._link.getAttribute('aria-expanded'), 'false');
	assert.equal(li._kids.hidden, true);

	assert.equal(router.syncAppSettingsNavExpansion(li, true), true);
	assert.equal(li.classList.contains('is-expanded'), true);
	assert.equal(li._link.getAttribute('aria-expanded'), 'true');
	assert.equal(li._kids.hidden, false);
});

test('syncAppSettingsNavExpansion is null-safe and coerces truthiness', () => {
	const router = loadRouter();
	assert.equal(router.syncAppSettingsNavExpansion(null, true), false);
	const li = makeNavParent({ expanded: false });
	assert.equal(router.syncAppSettingsNavExpansion(li, 0), false);
	assert.equal(li.classList.contains('is-expanded'), false);
	assert.equal(router.syncAppSettingsNavExpansion(li, 'yes'), true);
	assert.equal(li.classList.contains('is-expanded'), true);
});

test('router never hard-codes permanent expansion for app-settings', () => {
	assert.doesNotMatch(routerSrc, /is-expanded['"],\s*true\)/);
	assert.match(routerSrc, /syncAppSettingsNavExpansion\(li,\s*viewId\s*===\s*'app-settings'\)/);
});
