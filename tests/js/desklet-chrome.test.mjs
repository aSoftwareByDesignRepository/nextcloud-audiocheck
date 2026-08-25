/**
 * AudioCheck desklet chrome contracts — CSS + load() registration.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

describe('audiocheck dashboard desklet chrome', () => {
	it('ships desklet-nextcloud.css with AA touch and focus', () => {
		assert.equal(existsSync(path.join(appRoot, 'css/desklet-nextcloud.css')), true);
		const css = read('css/desklet-nextcloud.css');
		assert.match(css, /\.panel--header img\[src\*=\"\/audiocheck\/\"\]/);
		assert.match(css, /audiocheck/);
		assert.match(css, /min-height:\s*44px/);
		assert.match(css, /:focus-visible/);
		assert.match(css, /app-dashboard\.svg/);
		assert.match(css, /background-invert-if-dark/);
		assert.match(css, /prefers-reduced-motion/);
		assert.match(css, /a\.more/);
	});

	it('ContinueWidget load() registers desklet styles and absolute button link', () => {
		const trait = read('lib/Dashboard/RegistersDeskletStylesTrait.php');
		assert.match(trait, /Util::addStyle\(Application::APP_ID, 'desklet-nextcloud'\)/);
		const src = read('lib/Dashboard/ContinueWidget.php');
		assert.match(src, /RegistersDeskletStylesTrait/);
		assert.match(src, /registerDeskletStylesForWidget\(\)/);
		assert.match(src, /linkToRouteAbsolute/);
		assert.doesNotMatch(src, /new WidgetButton\(\s*WidgetButton::TYPE_MORE,\s*\$this->l10n->t\(/);
	});
});
