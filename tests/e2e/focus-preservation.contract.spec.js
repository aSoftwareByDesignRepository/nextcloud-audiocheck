// @ts-check
/**
 * FOCUS_PRESERVATION_CONTRACT — audiocheck permanent harness.
 *
 * Standing guard for the shared focus-rescue observer
 * (apps/_shared/focus-preservation, synced to js/common/focus-preservation.js).
 * Probes use DOM surgery (clone -> wipe -> re-add) so they do not depend on
 * seeded library content: the observer reacts to mutation records, so an
 * in-page rebuild exercises the exact machinery a real re-render would.
 *
 * Class refs: focus_loss_on_rebuild, focus_steal_after_leave,
 * interim_decoy_ends_rescue, landmark_uniqueness (COMPANION-DESIGN-SYSTEM §8).
 */
const { test } = require('@playwright/test');
const path = require('path');
const {
	assertRebuildPreservesFocus,
	assertLeaveThenWipeDoesNotSteal,
	assertInterimDecoyDoesNotEndRescue,
	assertUniqueLandmarks,
} = require(path.join(__dirname, '../../../_shared/e2e/focus-preservation-contract'));
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const FOCUSABLE = 'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
// Skip the skip-link: rescue targets live inside the main content region.
const TARGET = `#ac-main-content ${FOCUSABLE}, main ${FOCUSABLE}`;

// Inner list/group container holding the focused element — never the app
// root itself (detaching #app-content exercises the stale-arm path, which
// is a different class).
const SURGERY_CONTAINER = `a.closest('ul, ol, tbody, [role="list"], [role="group"], [id$="-page-actions"]') || a.parentElement`;

/** Detach the container holding the focused element and swap in a clone. */
const REBUILD = `(() => {
	const a = document.activeElement;
	const container = ${SURGERY_CONTAINER};
	const clone = container.cloneNode(true);
	container.replaceWith(clone);
	return true;
})()`;

test.describe('FOCUS_PRESERVATION_CONTRACT', () => {
	test.beforeEach(async ({ page }) => {
		const creds = resolveE2eCreds();
		test.skip(!creds, 'Needs NC_* / E2E_* credentials');
		await login(page, creds);
		await page.goto('/apps/audiocheck/', { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#app-content', { timeout: 30_000 });
		await page.waitForTimeout(1200);
	});

	test('rebuild under focus rescues to rebuilt equivalent (never body)', async ({ page }) => {
		await assertRebuildPreservesFocus(page, {
			target: TARGET,
			rebuild: () => page.evaluate(REBUILD),
		});
	});

	test('genuine leave then wipe does not steal focus back', async ({ page }) => {
		await assertLeaveThenWipeDoesNotSteal(page, {
			target: TARGET,
			leave: async () => {
				// Trusted gesture on neutral NC chrome (top-left header area).
				await page.mouse.click(10, 8);
				await page.waitForTimeout(150);
			},
			rebuild: () => page.evaluate(REBUILD),
		});
	});

	test('interim decoy inside wiped hood does not end the rescue', async ({ page }) => {
		// Focus the target first so we can capture its signature for the
		// same-signature landing assertion.
		const sig = await page.evaluate(`(() => {
			const el = document.querySelector(${JSON.stringify(TARGET)});
			if (!el) return null;
			el.focus();
			return el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 80);
		})()`);
		test.skip(!sig, 'no focusable target in main content');

		await assertInterimDecoyDoesNotEndRescue(page, {
			target: TARGET,
			wipe: () => page.evaluate(`(() => {
				const a = document.activeElement;
				const container = ${SURGERY_CONTAINER};
				window.__probeClone = container.cloneNode(true);
				window.__probeContainer = container;
				container.textContent = '';
				return true;
			})()`),
			paintInterim: () => page.evaluate(`(() => {
				const decoy = document.createElement('button');
				decoy.textContent = 'Loading…';
				decoy.setAttribute('aria-label', 'probe decoy');
				window.__probeContainer.appendChild(decoy);
				return true;
			})()`),
			rebuild: () => page.evaluate(`(() => {
				window.__probeContainer.replaceChildren(...window.__probeClone.childNodes);
				return true;
			})()`),
			expectSignature: sig,
		});
	});

	test('landmark uniqueness: no in-app banner, no top-level <footer>', async ({ page }) => {
		await assertUniqueLandmarks(page);
	});
});
