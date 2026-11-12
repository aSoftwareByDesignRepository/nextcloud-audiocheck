// @ts-check
/**
 * ATLAS web craft capture — transfer settings surfaces. Writes PNGs to
 * .cursor/atlas-farm-v3/artifacts/audiocheck/craft/web/.
 *
 * Ported from whistlecheck craft-transfer.spec.js + carecheck transfer.spec.js
 * (same synced config-transfer pack). Flow: /app-settings/transfer load →
 * uniform file error → real export→preview→report dialog → apply → progress
 * dialog → after-apply receipt (localized mode label, never the raw enum).
 *
 * Learned-assert legs baked in:
 *  - cramped_form_controls: replace-token input escapes the NC-core 130px pin
 *  - required_field_or_step_undiscoverable: report dialog footer (token row +
 *    Cancel + Apply import) paints INSIDE the dialog client box at 1280+375;
 *    .ac-dialog__body absorbs overflow, the dialog shell never scrolls
 *  - clipped_text_horizontal_overflow: @media (width<480px) the import card's
 *    mode fieldset + file input keep every leaf inside the card edge at 320px
 *    (donor 03a1dddb34 pins — re-rendered css/common/transfer.css carries
 *    #ac-transfer-{export,import}-form > * { min-width:0; width:100% } +
 *    input[type=file].ac-file-input specificity fix)
 *  - raw_enum_label_unlocalized: the Last-transfer line renders 'Merge',
 *    never the stored 'merge' wire value (en + zh_TW legs)
 *  - raw_placeholder_rendered: verdict/file lines carry interpolated values,
 *    never %d/%s/%1$s/{0} residue
 *  - native_dialog_margin_reset_uncentered: ≥481px pack dialogs centered
 *    both axes over the backdrop (pack margin:auto survives the NC core
 *    'html,body,…,dialog,…{margin:0}' reset); ≤480px keeps the margin:0
 *    full-bleed sheet (donor dialog.ac-dialog element qualifier)
 *
 * Session note: SessionCsrfMiddleware demands the session requesttoken on
 * every non-GET — API calls go through the page's own authenticated request
 * context + OC.requestToken, never bare basic auth.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { login, resolveE2eCreds } = require('./helpers/auth.js');
const { assertAtlasRenderedSurface } = require(path.join(__dirname, '../../../_shared/e2e/atlas-rendered-surface-contract'));

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const APP = `${BASE}/index.php/apps/audiocheck`;
const PAGE = `${APP}/app-settings/transfer`;
const PASS = 'atlas-e2e-passphrase-2026';
const NC_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.resolve(NC_ROOT, '..', '.cursor/atlas-farm-v3/artifacts/audiocheck/craft/web');
fs.mkdirSync(OUT, { recursive: true });

function compose(cmd) {
	return execSync(`docker compose exec -T -u www-data nextcloud ${cmd}`,
		{ encoding: 'utf8', timeout: 180_000, cwd: NC_ROOT });
}
const occ = (args) => compose(`php occ ${args}`).trim();
const queryDb = (q) => execSync(
	`docker compose exec -T mariadb bash -c 'echo ${Buffer.from(q).toString('base64')} | base64 -d | mariadb -u root -p"$MYSQL_ROOT_PASSWORD" nextcloud -N'`,
	{ encoding: 'utf8', timeout: 60_000, cwd: NC_ROOT }).trim();

async function shot(page, name) {
	await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}
/** Authenticated request through the page's own cookie jar + session CSRF. */
async function authedPost(page, url, data) {
	const token = await page.evaluate(() => (window.OC && window.OC.requestToken) || '');
	return page.context().request.post(url, {
		data,
		headers: { requesttoken: token, 'OCS-APIRequest': 'true' },
	});
}
async function authedGet(page, url) {
	return page.context().request.get(url, { headers: { 'OCS-APIRequest': 'true' } });
}

/** native_dialog_margin_reset_uncentered: NC core's html,body,…,dialog
 * reset zeroes the UA 'margin:auto' that centers a top-layer <dialog> —
 * a pack dialog without a margin re-declaration anchors to the viewport
 * top-left. mode 'centered' proves the pack margin:auto restored both-axis
 * centering over the dimmed backdrop; mode 'fullbleed' proves the ≤480px
 * media query margin:0 sheet still wins at narrow widths. */
async function assertDialogTopLayerGeometry(dialog, mode, where) {
	const m = await dialog.evaluate((d) => {
		const r = d.getBoundingClientRect();
		return { l: r.left, t: r.top, w: r.width, h: r.height, vpW: window.innerWidth, vpH: window.innerHeight };
	});
	if (mode === 'centered') {
		const expL = Math.max(0, (m.vpW - m.w) / 2);
		const expT = Math.max(0, (m.vpH - m.h) / 2);
		expect(Math.abs(m.l - expL),
			`${where}: dialog left ${Math.round(m.l)} ≠ centered ${Math.round(expL)} — margin:auto did not survive the NC reset`)
			.toBeLessThanOrEqual(2);
		expect(Math.abs(m.t - expT),
			`${where}: dialog top ${Math.round(m.t)} ≠ centered ${Math.round(expT)}`)
			.toBeLessThanOrEqual(2);
		expect(m.l, `${where}: flush-left top-left anchor regression`).toBeGreaterThan(1);
	} else {
		expect(Math.abs(m.l), `${where}: ≤480 full-bleed sheet must pin to the left edge`).toBeLessThanOrEqual(1);
		expect(m.w, `${where}: ≤480 full-bleed sheet must span viewport width`).toBeGreaterThanOrEqual(m.vpW - 1);
		expect(m.t, `${where}: ≤480 full-bleed sheet must pin to the top edge`).toBeLessThanOrEqual(1);
	}
}

test.describe('craft transfer', () => {
	const creds = resolveE2eCreds('ADMIN');

	test('transfer surface + report/progress dialogs 1280', async ({ page }) => {
		test.setTimeout(240_000);

		await page.setViewportSize({ width: 1280, height: 800 });
		await login(page, creds);
		await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-transfer-export-card')).toBeVisible({ timeout: 20000 });

		const exp = await authedPost(page, `${APP}/api/admin/transfer/export`, { passphrase: PASS });
		expect(exp.status()).toBe(200);
		const bytes = await exp.body();
		expect(bytes.length).toBeGreaterThan(200);

		await page.waitForTimeout(600);
		await shot(page, 'ac-admin-transfer-light-1280');

		// uniform file error — wrong passphrase on a real container
		await page.locator('#ac-transfer-file').setInputFiles({
			name: 't.nctransfer', mimeType: 'application/json', buffer: bytes,
		});
		await page.locator('#ac-transfer-import-passphrase').fill('wrong-passphrase-000');
		// errors surface through the app-owned toast (#ac-toasts role=alert),
		// never a raw code — 'Cannot read this file — wrong passphrase…'
		const errToast = page.locator('#ac-toasts [role="alert"]');
		await expect(errToast).toBeVisible({ timeout: 30000 });
		await expect(errToast).toContainText(/file|passphrase/i);
		await expect(errToast).not.toContainText(/TRANSFER_[A-Z_]+/);
		await shot(page, 'ac-admin-transfer-fileerror-light-1280');

		// correct passphrase → preview → report dialog (interpolated counters)
		await page.locator('#ac-transfer-import-passphrase').fill(PASS);
		const report = page.locator('#ac-transfer-report');
		await expect(report).toBeVisible({ timeout: 30000 });
		await expect(page.locator('#ac-transfer-report-verdict')).toContainText(/\d/);
		const fileLine = await page.locator('#ac-transfer-report-file').textContent();
		expect(fileLine || '').not.toMatch(/\{\d+\}|%\d+\$s|%d(?!\w)/);
		await assertDialogTopLayerGeometry(report, 'centered', 'report 1280');
		await shot(page, 'ac-admin-transfer-report-dialog-light-1280');

		// apply → progress dialog opens while the job is queued
		const applyResp = page.waitForResponse(
			(r) => r.url().includes('/api/admin/transfer/apply'), { timeout: 30000 });
		await page.locator('#ac-transfer-confirm').click();
		const ar = await applyResp;
		if (ar.status() !== 200) {
			throw new Error(`transfer apply returned ${ar.status()}: ${(await ar.text()).slice(0, 300)}`);
		}
		const progress = page.locator('#ac-transfer-progress');
		await expect(progress).toBeVisible({ timeout: 10000 });
		await expect(page.locator('#ac-transfer-progress-text')).not.toBeEmpty();
		await assertDialogTopLayerGeometry(progress, 'centered', 'progress 1280');
		await shot(page, 'ac-admin-transfer-progress-light-1280');

		// app-namespaced class id — other apps' TransferApplyJob rows never match
		const jobId = queryDb("SELECT id FROM oc_jobs WHERE class LIKE '%AudioCheck%TransferApplyJob%' ORDER BY id DESC LIMIT 1");
		expect(jobId).toMatch(/^\d+$/);
		const priorReceiptId = ((((await (await authedGet(page, `${APP}/api/admin/transfer/status`)).json()).data || {}).lastReceipt) || {}).id || '';
		occ(`background-job:execute ${jobId}`);

		let receipt = {};
		for (let i = 0; i < 60; i++) {
			const s = await authedGet(page, `${APP}/api/admin/transfer/status`);
			receipt = (((await s.json()).data || {}).lastReceipt) || {};
			if (receipt.id && receipt.id !== priorReceiptId
				&& (receipt.result === 'applied' || receipt.result === 'failed')) break;
			await page.waitForTimeout(1000);
		}
		expect(receipt.result).toBe('applied');

		// localized receipt mode label — never the raw stored enum
		const last = await page.locator('#ac-transfer-last').innerText();
		expect(last).toContain('Merge');
		expect(last).not.toMatch(/·\s*(merge|replace)\b/);
		await page.waitForTimeout(600);
		await shot(page, 'ac-admin-transfer-after-apply-light-1280');
	});

	test('transfer surface mobile 375 + 320 geometry (no mid-word clip)', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await login(page, creds);
		await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-transfer-export-card')).toBeVisible({ timeout: 20000 });
		await page.waitForTimeout(600);
		await shot(page, 'ac-admin-transfer-light-375');

		// clipped_text_horizontal_overflow: a fieldset flex item cannot shrink
		// below content width; the import card's mode fieldset + file input used
		// to clip mid-word at the sheet's right edge at 320. Geometry, not pixels.
		await page.setViewportSize({ width: 320, height: 800 });
		const clips = await page.locator('#ac-transfer-import-card').evaluate((card) => {
			const cardR = card.getBoundingClientRect();
			const bad = [];
			for (const el of card.querySelectorAll('fieldset, legend, label, span, p, input, div')) {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) { continue; }
				if (r.right > cardR.right + 1 || r.left < cardR.left - 1) {
					bad.push(`${el.tagName}.${String(el.className)} rect ${r.left.toFixed(0)}-${r.right.toFixed(0)} outside card ${cardR.left.toFixed(0)}-${cardR.right.toFixed(0)}`);
				}
				if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1) {
					bad.push(`${el.tagName}.${String(el.className)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
				}
			}
			return bad;
		});
		expect(clips, 'content overflowing the transfer card at 320px').toEqual([]);
		const docOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(docOverflow, 'page-level horizontal overflow at 320px').toBeLessThanOrEqual(1);
		await shot(page, 'ac-admin-transfer-light-320');
	});

	test('replace-confirm token row wide + footer painted (1280/375)', async ({ page }) => {
		test.setTimeout(180_000);

		await page.setViewportSize({ width: 1280, height: 800 });
		await login(page, creds);
		await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-transfer-export-card')).toBeVisible({ timeout: 20000 });

		const exp = await authedPost(page, `${APP}/api/admin/transfer/export`, { passphrase: PASS });
		expect(exp.status()).toBe(200);
		const bytes = await exp.body();
		expect(bytes.length).toBeGreaterThan(200);

		// Full-form pinned-control sweep (rendered-surface contract on the island).
		await assertAtlasRenderedSurface(page, { content: '#app-content.ac-app' });

		// Replace mode → real preview → report dialog footer shows token row.
		await page.locator('#ac-transfer-import-form input[type="radio"][value="replace"]').check();
		await page.locator('#ac-transfer-file').setInputFiles({
			name: 't.nctransfer', mimeType: 'application/json', buffer: bytes,
		});
		await page.locator('#ac-transfer-import-passphrase').fill(PASS);
		const report = page.locator('#ac-transfer-report');
		await expect(report).toBeVisible({ timeout: 30000 });
		const tokenRow = page.locator('#ac-transfer-replace-confirm');
		await expect(tokenRow).toBeVisible();
		const token = page.locator('#ac-transfer-replace-token');
		await expect(token).toBeVisible();

		// cramped_form_controls fix live: the input escapes the core 130px pin.
		const w = await token.evaluate((el) => el.getBoundingClientRect().width);
		expect(w, `token input ${Math.round(w)}px still on the NC-core 130px pin`).toBeGreaterThan(140);

		// Apply must stay gated until the user types REPLACE verbatim.
		const confirm = page.locator('#ac-transfer-confirm');
		await token.fill('REPLAC');
		expect(await confirm.isDisabled()).toBeTruthy();
		await token.fill('REPLACE');
		expect(await confirm.isDisabled()).toBeFalsy();

		// required_field_or_step_undiscoverable: report dialog footer — token
		// row + Cancel + Apply import — inside the dialog client box.
		const assertDialogFooterPainted = async (where) => {
			const g = await report.evaluate((d) => {
				const cs = getComputedStyle(d);
				const r = d.getBoundingClientRect();
				const bt = parseFloat(cs.borderTopWidth) || 0;
				const bl = parseFloat(cs.borderLeftWidth) || 0;
				const client = { top: r.top + bt, left: r.left + bl, bottom: r.top + bt + d.clientHeight, right: r.left + bl + d.clientWidth };
				const f = d.querySelector('.ac-dialog__footer').getBoundingClientRect();
				const a = d.querySelector('#ac-transfer-confirm').getBoundingClientRect();
				return { client, dScrollH: d.scrollHeight, dClientH: d.clientHeight,
					footer: { top: f.top, bottom: f.bottom, left: f.left, right: f.right },
					apply: { top: a.top, bottom: a.bottom, left: a.left, right: a.right } };
			});
			for (const [name, box] of Object.entries({ footer: g.footer, apply: g.apply })) {
				expect(box.bottom, `${where}: ${name} bottom ${Math.round(box.bottom)} hangs below dialog client box ${Math.round(g.client.bottom)}`).toBeLessThanOrEqual(g.client.bottom + 0.5);
				expect(box.top, `${where}: ${name} top above dialog client box`).toBeGreaterThanOrEqual(g.client.top - 0.5);
				expect(box.right, `${where}: ${name} right outside dialog client box`).toBeLessThanOrEqual(g.client.right + 0.5);
				expect(box.left, `${where}: ${name} left outside dialog client box`).toBeGreaterThanOrEqual(g.client.left - 0.5);
			}
			expect(g.dScrollH - g.dClientH,
				`${where}: dialog shell scrolls (scrollHeight ${g.dScrollH} > clientHeight ${g.dClientH}) — .ac-dialog__body must absorb the overflow`)
				.toBeLessThanOrEqual(1);
		};
		await assertDialogFooterPainted('1280');
		await assertDialogTopLayerGeometry(report, 'centered', 'replace-confirm 1280');
		await shot(page, 'ac-admin-transfer-replace-confirm-light-1280');
		await page.setViewportSize({ width: 375, height: 812 });
		await page.waitForTimeout(300);
		await assertDialogFooterPainted('375');
		await assertDialogTopLayerGeometry(report, 'fullbleed', 'replace-confirm 375');
		await shot(page, 'ac-admin-transfer-replace-confirm-light-375');
		await page.setViewportSize({ width: 320, height: 700 });
		await page.waitForTimeout(300);
		await assertDialogFooterPainted('320');
		await assertDialogTopLayerGeometry(report, 'fullbleed', 'replace-confirm 320');
		await shot(page, 'ac-admin-transfer-replace-confirm-light-320');
		// Never apply — replace is destructive; close the dialog instead.
		await page.keyboard.press('Escape');
		await expect(report).toBeHidden();
	});

	test('zh_TW receipt renders localized mode label (no raw enum)', async ({ page }) => {
		// Seed a deterministic receipt so the Last-transfer line renders, then
		// view the page with a zh_TW preference — raw_enum_label_unlocalized:
		// 'merge'/'replace' must map through $l->t(), never print verbatim.
		let prevReceipts = '';
		try { prevReceipts = occ('config:app:get audiocheck transfer_receipts'); } catch { /* unset */ }
		const seed = JSON.stringify([{
			id: 'e2e-zh-receipt', at: '2026-11-11T22:00:00Z', actor: creds.username,
			mode: 'merge', result: 'applied',
			counts: { configApplied: 1, rowsInserted: 0, rowsUpdated: 2, rowsSkipped: 0, rowsDeleted: 0, refsUnresolved: 0 },
			snapshotId: null,
		}]);
		try {
			occ(`config:app:set audiocheck transfer_receipts --value='${seed}'`);
			occ(`user:setting ${creds.username} core lang zh_TW`);
			await page.context().setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9' });
			await page.setViewportSize({ width: 1280, height: 900 });
			await login(page, creds);
			await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
			await expect(page.locator('#ac-transfer-export-card')).toBeVisible({ timeout: 20000 });
			const last = await page.locator('#ac-transfer-last').innerText();
			expect(last).toContain('合併');
			expect(last).not.toMatch(/·\s*(merge|replace)\b/);
			await shot(page, 'ac-admin-transfer-receipt-zh-tw-1280');
		} finally {
			try {
				occ(`user:setting ${creds.username} core lang en`);
				if (prevReceipts) {
					occ(`config:app:set audiocheck transfer_receipts --value='${prevReceipts}'`);
				} else {
					occ('config:app:delete audiocheck transfer_receipts');
				}
			} catch { /* restore best-effort */ }
		}
	});
});
