// @ts-check
/**
 * Rendered regression proof for overlay_toast_button_armor_gap
 * (audiocheck-intake-20261112T033634Z / check-btn-variant-armor.py
 * overlay-close leg): the overlay close controls
 * <button class="ac-toast__close"> (body-mounted #ac-toasts stack) and
 * <button class="ac-modal__close"> (top-layer native dialog) used to be
 * painted only by bare / overlay-scoped rules that left width, padding and
 * margin to NC core's `button:not(.button-vue,[class^=vs__])` repaint
 * (0-1-1: width:130px + pale fill + border + padding) and the
 * `:not(.app-navigation-entry-button)` margin repaint (0-2-1) — a ~130px
 * pale block instead of the declared transparent 44px icon-close.
 *
 * Legs (light AND dark — the pale-fill collapse is theme-visible):
 *  - toast: AudioCheckMessaging.toast → .ac-toasts .ac-toast__close
 *  - modal: AudioCheckComponents.openModal → button.ac-modal__close
 * Computed assertions: ~44px box (never ~130px), transparent background,
 * zero border, inline-end placement inside the overlay row.
 * Craft PNGs → .cursor/atlas-farm-v3/artifacts/audiocheck/craft/web/.
 *
 * Theme is flipped by body-class mutation (same mechanism as
 * theme-responsive-a11y.spec.js) — no user-pref write, safe on shared farms.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const APP_URL = '/apps/audiocheck/';
const NC_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT = path.resolve(NC_ROOT, '..', '.cursor/atlas-farm-v3/artifacts/audiocheck/craft/web');
fs.mkdirSync(OUT, { recursive: true });
const THEMES = ['light', 'dark'];

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

async function ensureAuthed(page) {
	if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
		await login(page, resolveE2eCreds('ADMIN'));
	}
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'light'|'dark'} themeId
 */
async function applyTheme(page, themeId) {
	await page.evaluate((id) => {
		const body = document.body;
		[
			'theme--light',
			'theme--dark',
			'theme--dark-highcontrast',
			'theme--light-highcontrast',
		].forEach((c) => body.classList.remove(c));
		[
			'data-theme-default',
			'data-theme-light',
			'data-theme-dark',
			'data-theme-dark-highcontrast',
			'data-theme-light-highcontrast',
		].forEach((a) => body.removeAttribute(a));

		if (id === 'light') {
			body.classList.add('theme--light');
			body.setAttribute('data-theme-light', 'true');
			body.setAttribute('data-themes', 'default');
		} else {
			body.classList.add('theme--dark');
			body.setAttribute('data-theme-dark', 'true');
			body.setAttribute('data-themes', 'dark');
		}
		document.documentElement.style.colorScheme = id === 'dark' ? 'dark' : 'light';
	}, themeId);
	await page.waitForTimeout(150);
}

/**
 * Computed armor probe: the close control must be a compact transparent
 * icon button — never core's 130px pale repaint.
 * @param {import('@playwright/test').Locator} closeBtn
 */
async function probeCloseButton(closeBtn) {
	return closeBtn.evaluate((node) => {
		// Probe the BASE armored state: the design intentionally paints
		// --ac-bg-soft under :focus-visible, and the modal's focus trap can
		// land focus on the close control — that is feedback, not the
		// core repaint collapse.
		if (node === document.activeElement) node.blur();
		const cs = getComputedStyle(node);
		const rect = node.getBoundingClientRect();
		const parentRect = node.parentElement.getBoundingClientRect();
		return {
			cssWidth: cs.width,
			rectWidth: rect.width,
			rectHeight: rect.height,
			background: cs.backgroundColor,
			borderTopWidth: cs.borderTopWidth,
			borderTopStyle: cs.borderTopStyle,
			padding: cs.padding,
			marginInlineStart: cs.marginInlineStart,
			// inline-end placement: right edge of the control vs its row
			inlineEndGap: Math.round(parentRect.right - rect.right),
			inlineStartGap: Math.round(rect.left - parentRect.left),
		};
	});
}

function expectArmoredIconClose(probe, label) {
	// Compact icon-close: >=40px touch target, far below core's 130px pin.
	expect(probe.rectWidth, `${label}: width`).toBeGreaterThanOrEqual(40);
	expect(probe.rectWidth, `${label}: width must escape the core 130px repaint`).toBeLessThan(80);
	// Transparent fill — the collapse signature was a pale element-light block.
	expect(
		['rgba(0, 0, 0, 0)', 'transparent'].includes(probe.background),
		`${label}: background must be transparent, got ${probe.background}`,
	).toBeTruthy();
	// Toast close is borderless; modal close keeps a 1px transparent border —
	// both declare a border prop the core repaint cannot retint.
	if (label === 'toast') {
		expect(probe.borderTopWidth, `${label}: border`).toBe('0px');
	}
	// Mutation-sensitive discriminator: the armor pins --ac-space-2 (8px) on
	// every side !important; unarmored, core's repaint lands
	// `padding:7px 14px` (older builds) or calc((44px-1lh)/2) 12px
	// (~'7.625px 12px' on NC35) — '8px' proves OUR rule won the cascade.
	expect(probe.padding, `${label}: armor padding must win (8px, got ${probe.padding})`).toBe('8px');
	// Inline-end placement: the control hugs the row's end edge, not the
	// text (core's margin-inline-start:0 repaint would left-pack it).
	expect(probe.inlineEndGap, `${label}: inline-end gap`).toBeLessThanOrEqual(24);
}

test.describe('overlay close-control armor (overlay_toast_button_armor_gap)', () => {
	test.skip(!hasAnyCreds(), 'no e2e credentials or storage state');

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await ensureAuthed(page);
		await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');
	});

	for (const theme of THEMES) {
		test(`toast + modal close buttons render as transparent icon-close (${theme})`, async ({ page }) => {
			await applyTheme(page, theme);

			// ── toast leg ──────────────────────────────────────────────
			await page.evaluate(() => {
				window.AudioCheckMessaging.toast('overlay armor probe', 'info');
			});
			const toastClose = page.locator('.ac-toasts .ac-toast__close').first();
			await toastClose.waitFor({ state: 'visible' });
			const toastProbe = await probeCloseButton(toastClose);
			expectArmoredIconClose(toastProbe, 'toast');
			await page.screenshot({
				path: path.join(OUT, `ac-overlay-close-armor-toast-${theme}-1280.png`),
				fullPage: false,
			});
			await toastClose.screenshot({
				path: path.join(OUT, `ac-overlay-close-armor-toast-btn-${theme}-1280.png`),
			});

			// ── modal leg ──────────────────────────────────────────────
			await page.evaluate(() => {
				window.AudioCheckComponents.openModal({
					title: 'Overlay armor probe',
					render: () => {
						const p = document.createElement('p');
						p.textContent = 'Close button must stay a compact transparent icon.';
						return p;
					},
					primaryLabel: 'OK',
					cancelLabel: 'Cancel',
					onSubmit: () => true,
				});
			});
			const modalClose = page.locator('dialog.ac-native-dialog button.ac-modal__close').first();
			await modalClose.waitFor({ state: 'visible' });
			await page.mouse.move(0, 0);
			const modalProbe = await probeCloseButton(modalClose);
			expectArmoredIconClose(modalProbe, 'modal');
			expect(
				['1px'].includes(modalProbe.borderTopWidth),
				`modal: border must keep the declared 1px transparent box, got ${modalProbe.borderTopWidth}`,
			).toBeTruthy();
			// margin-inline-start:auto must be live: inside the space-between
			// header it absorbs the free space (unarmored = core's 0px repaint;
			// the toast row's flex:1 text legitimately resolves its own auto
			// margin to 0, so this discriminator is modal-only).
			expect(
				parseFloat(modalProbe.marginInlineStart),
				`modal: margin-inline-start:auto must win, got ${modalProbe.marginInlineStart}`,
			).toBeGreaterThan(0);
			await page.screenshot({
				path: path.join(OUT, `ac-overlay-close-armor-modal-${theme}-1280.png`),
				fullPage: false,
			});
			await modalClose.screenshot({
				path: path.join(OUT, `ac-overlay-close-armor-modal-btn-${theme}-1280.png`),
			});

			// leave no residue on the shared instance
			await page.evaluate(() => {
				const open = window.AudioCheckComponents.getOpenModal
					? window.AudioCheckComponents.getOpenModal()
					: null;
				if (open) open.close(false);
				document.querySelectorAll('#ac-toasts .ac-toast').forEach((n) => n.remove());
			});
		});
	}
});
