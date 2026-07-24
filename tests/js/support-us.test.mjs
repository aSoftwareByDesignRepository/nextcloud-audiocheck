/**
 * Contract tests for Support & Us JS helper (node, no DOM required for linksFor).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const src = readFileSync(path.join(appRoot, 'js/common/support-us.js'), 'utf8');

const sandbox = { window: {}, globalThis: {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);

const linksFor = sandbox.SbdSupportUs.linksFor;
assert.equal(typeof linksFor, 'function');

const de = linksFor('de_DE');
const en = linksFor('en');

assert.match(de.partnerMailto, /^mailto:info@software-by-design\.de\?subject=/);
assert.ok(de.partnerMailto.includes(encodeURIComponent('AudioCheck: Partner / Care Retainer')));
assert.ok(en.partnerMailto.includes(encodeURIComponent('AudioCheck: partner / care retainer')));
assert.equal(de.supportPageUrl, 'https://nextcloud.software-by-design.de/de/support.html');
assert.equal(en.appsPageUrl, 'https://nextcloud.software-by-design.de/en/apps.html');
assert.equal(de.sponsorsUrl, 'https://github.com/sponsors/aSoftwareByDesignRepository');
assert.ok(!JSON.stringify(de).includes('490'));
assert.ok(!JSON.stringify(en).includes('€'));

console.log('support-us.js contract OK');
