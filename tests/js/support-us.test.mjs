/**
 * Contract + DOM mount tests for Support & Us JS helper.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(path.join(appRoot, 'js/common/support-us.js'), 'utf8');

function makeDocument() {
	class FakeNode {
		constructor(tag) {
			this.tagName = String(tag || '').toUpperCase();
			this.children = [];
			this.attributes = {};
			this.className = '';
			this.textContent = '';
			this.childNodes = this.children;
		}
		setAttribute(k, v) {
			this.attributes[k] = String(v);
			if (k === 'id') this.id = String(v);
		}
		getAttribute(k) { return this.attributes[k]; }
		appendChild(child) { this.children.push(child); return child; }
		querySelector(sel) {
			if (sel === '[data-support-us="1"]') {
				return this._findSupport(this);
			}
			return null;
		}
		_findSupport(node) {
			if (node.attributes && node.attributes['data-support-us'] === '1') {
				return node;
			}
			for (const c of node.children || []) {
				const hit = this._findSupport(c);
				if (hit) return hit;
			}
			return null;
		}
	}
	return {
		createElement: (tag) => new FakeNode(tag),
		createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
	};
}

const document = makeDocument();
const sandbox = { window: {}, globalThis: {}, document, OC: { getLanguage: () => 'en' } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);

const api = sandbox.SbdSupportUs;
assert.equal(typeof api.linksFor, 'function');
assert.equal(typeof api.render, 'function');
assert.equal(api.isGermanLocale('de_DE'), true);
assert.equal(api.isGermanLocale('den'), false);

const de = api.linksFor('de_DE');
const en = api.linksFor('en');
assert.match(de.partnerMailto, /^mailto:info@software-by-design\.de\?subject=/);
assert.ok(de.partnerMailto.includes(encodeURIComponent('AudioCheck: Partner / Care Retainer')));
assert.ok(en.partnerMailto.includes(encodeURIComponent('AudioCheck: partner / care retainer')));
assert.equal(de.supportPageUrl, 'https://nextcloud.software-by-design.de/de/support.html');
assert.equal(en.appsPageUrl, 'https://nextcloud.software-by-design.de/en/apps.html');
assert.equal(de.sponsorsUrl, 'https://github.com/sponsors/aSoftwareByDesignRepository');
assert.ok(!JSON.stringify(de).includes('490'));
assert.ok(!JSON.stringify(en).includes('€'));

assert.throws(() => api.linksFor('en', { hasOfficialMobileLicenses: true }));
const withLicense = api.linksFor('en', {
	hasOfficialMobileLicenses: true,
	licensePageUrl: '/apps/audiocheck/license',
});
assert.equal(withLicense.licensePageUrl, '/apps/audiocheck/license');

const mount = document.createElement('div');
const section = api.render(mount, { appId: 'audiocheck', shellPrefix: 'ac' });
assert.ok(section);
assert.equal(section.getAttribute('data-support-us'), '1');
assert.equal(section.id, 'ac-support-us');
assert.ok(String(section.className).includes('ac-card'));
assert.ok(String(section.className).includes('ac-support-us'));
assert.equal(api.render(mount, { appId: 'audiocheck' }), null, 'double-mount must no-op');

const mobileMount = document.createElement('div');
api.render(mobileMount, {
	appId: 'audiocheck',
	shellPrefix: 'ac',
	hasOfficialMobileLicenses: true,
	licensePageUrl: '/apps/audiocheck/license',
});
const walked = [];
(function walk(n) {
	if (!n) return;
	if (n.attributes && n.attributes.href) walked.push(n.attributes.href);
	(n.children || []).forEach(walk);
})(mobileMount);
assert.ok(walked.includes('/apps/audiocheck/license'));

console.log('support-us.js contract OK (audiocheck)');
