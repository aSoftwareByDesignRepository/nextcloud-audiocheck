// @ts-check
'use strict';

/**
 * Locale-safe assertions for e2e specs (Atlas 3.5.13):
 * fixture users run arbitrary locales, so never match visible text or
 * accessible names by EN|DE regex. Resolve the expected string through the
 * app's own translation function instead — works for any fixture locale.
 *
 *   const label = await appT(page, 'Close player');
 *   await expect(locator).toHaveAttribute('aria-label', label);
 *
 * `vars` mirrors window.t(app, key, vars) for parameterized strings.
 */
async function appT(page, key, vars) {
	return page.evaluate(
		({ k, v }) => {
			const t = (typeof window !== 'undefined' && typeof window.t === 'function') ? window.t : null;
			return t ? t('audiocheck', k, v || undefined) : k;
		},
		{ k: key, v: vars },
	);
}

module.exports = { appT };
