// @ts-check
/**
 * ATLAS ds_chrome live contrast probe (audiocheck).
 *
 * Logs in, walks representative pages, and measures the COMPUTED WCAG 2.1
 * contrast of semantic chrome: status badges, primary/danger buttons,
 * invalid-field borders + inline error text, and control borders — across
 * all four shipped themes (light / dark / light-hc / dark-hc).
 *
 *   text ink   >= 4.5:1  (WCAG 1.4.3 AA)
 *   borders    >= 3.0:1  (WCAG 1.4.11)
 *
 * Usage (from the app dir):
 *   node tests/e2e/helpers/atlas-contrast-probe.mjs [--out <path.json>]
 *
 * Requires e2e creds in tests/e2e/.env or e2e/.env (E2E_USER/E2E_PASSWORD or
 * NC_ADMIN_*) and a live Nextcloud at E2E_BASE/NC_BASE_URL (default
 * http://localhost:8081). Credentials are never printed.
 */
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '../../..')
const require = createRequire(join(APP_ROOT, 'package.json'))
const { chromium } = require('playwright')
const { login } = require(join(HERE, 'auth.js'))

// Pull credentials from the app e2e env file if not already exported.
for (const envFile of [join(APP_ROOT, 'e2e/.env'), join(APP_ROOT, 'tests/e2e/.env')]) {
	if (!existsSync(envFile)) continue
	for (const line of readFileSync(envFile, 'utf8').split('\n')) {
		const t = line.trim()
		if (!t || t.startsWith('#')) continue
		const eq = t.indexOf('=')
		if (eq <= 0) continue
		const k = t.slice(0, eq).trim()
		let v = t.slice(eq + 1).trim()
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
		if (process.env[k] === undefined) process.env[k] = v
	}
}

const BASE = (process.env.NC_BASE_URL || process.env.E2E_BASE || 'http://localhost:8081').replace(/\/$/, '')
const USER = process.env.E2E_USER || process.env.NC_ADMIN_USER
const PASS = process.env.E2E_PASSWORD || process.env.E2E_PASS || process.env.NC_ADMIN_PASS
if (!USER || !PASS) throw new Error('missing E2E_USER/E2E_PASSWORD (tests/e2e/.env)')

const THEMES = ['light', 'dark', 'light-highcontrast', 'dark-highcontrast']

// ── WCAG contrast helpers (injected into the page for computed colors) ──
const EVAL_FN = String.raw`
function hexToRgb(c) {
  c = c.trim()
  // Chrome serialises color-mix() as color(srgb r g b / a) — floats 0..1.
  if (c.startsWith('color(')) {
    const m = c.match(/[\d.]+/g)
    if (m && m.length >= 3) {
      const s = m.map(parseFloat)
      const scale = s.every((v) => v <= 1) ? 255 : 1
      return [s[0] * scale, s[1] * scale, s[2] * scale]
    }
    return null
  }
  if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g)
    if (m && m.length >= 3) return [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])]
    return null
  }
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3) h = h.split('').map(x => x + x).join('')
    if (h.length === 4) h = h.split('').map(x => x + x).join('')
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
    }
  }
  return null
}
function lum(rgb) {
  const f = v => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
function effBg(el) {
  // Walk ancestors for the first non-transparent background.
  let n = el
  while (n && n !== document.documentElement) {
    const bg = getComputedStyle(n).backgroundColor
    const m = bg && bg.match(/[\d.]+/g)
    if (m && m.length >= 4 && parseFloat(m[3]) > 0) return bg
    if (m && m.length === 3 && !bg.includes('transparent')) return bg
    n = n.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}
function outerBg(el) {
  // WCAG 1.4.11 measures a component boundary against the ADJACENT surface —
  // the parent's effective background, not the element's own fill (a solid
  // button's border matching its fill is fine as long as the outer edge
  // separates the component from what is behind it).
  return effBg(el && el.parentElement ? el.parentElement : el)
}
function alphaOf(c) {
  const m = c && c.match(/[\d.]+/g)
  if (m && m.length >= 4) return parseFloat(m[3])
  if (c && c.startsWith('color(')) {
    const parts = c.match(/[\d.]+/g)
    if (parts && parts.length >= 4) return parseFloat(parts[3])
  }
  return 1
}
function blend(fgRgb, bgRgb, a) {
  return [
    a * fgRgb[0] + (1 - a) * bgRgb[0],
    a * fgRgb[1] + (1 - a) * bgRgb[1],
    a * fgRgb[2] + (1 - a) * bgRgb[2],
  ]
}
function ratio(fg, bg) {
  const a = hexToRgb(fg), b = hexToRgb(bg)
  if (!a || !b) return null
  const l1 = lum(a), l2 = lum(b)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}
function borderRatio(border, bg) {
  const f = hexToRgb(border), b = hexToRgb(bg)
  if (!f || !b) return null
  const alpha = alphaOf(border)
  const eff = alpha >= 1 ? f : blend(f, b, alpha)
  const l1 = lum(eff), l2 = lum(b)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}
window.__acProbe = { effBg, outerBg, ratio, alphaOf, borderRatio }
`

/** Pages + selectors measured per theme. Missing elements simply yield found=0. */
const PROBES = [
	{
		page: '/apps/audiocheck/',
		label: 'index',
		rows: [
			{ sel: '#ac-main-content h1, .ac-page-header__title, .ac-page-header h2', kind: 'page-title', what: 'text' },
			{ sel: '.ac-empty-state, .ac-empty, .ac-home-hero__badge', kind: 'empty-or-badge', what: 'text+border' },
			{ sel: '#app-navigation a, #app-navigation button', kind: 'nav-ink', what: 'text' },
		],
	},
	{
		page: '/apps/audiocheck/music',
		label: 'music',
		rows: [
			{ sel: '.ac-track-list__row, .ac-empty-state, .ac-empty', kind: 'track-or-empty', what: 'text' },
			{ sel: '.ac-media-library-status, .ac-library-bar__status--warn, .ac-library-bar__status--ok', kind: 'status-ink', what: 'text' },
			{ sel: '#ac-main-content input:not([type="hidden"], [type="radio"], [type="checkbox"], [type="range"]), #ac-main-content select', kind: 'control-border', what: 'border' },
		],
	},
	{
		page: '/apps/audiocheck/library',
		label: 'library',
		rows: [
			{ sel: '.ac-library-card__remove, .ac-btn--danger', kind: 'danger-btn', what: 'text+border' },
			{ sel: '.ac-media-library-status, .ac-library-bar__status--ok, .ac-library-bar__status--warn', kind: 'status-ink', what: 'text' },
			{ sel: '.ac-library-empty__btn, .ac-btn--primary', kind: 'primary-cta', what: 'text+border' },
		],
	},
	{
		page: '/apps/audiocheck/settings',
		label: 'settings',
		rows: [
			{ sel: '#ac-main-content input:not([type="hidden"], [type="radio"], [type="checkbox"], [type="range"]), #ac-main-content select', kind: 'control-border', what: 'border' },
			{ sel: '.ac-btn--primary, button[type="submit"]', kind: 'primary-cta', what: 'text+border' },
			{ sel: '.ac-field__hint, .ac-fieldset__legend', kind: 'hint-ink', what: 'text' },
			// Range controls render via the pseudo track — measure its painted border.
			{ sel: '.ac-volume__slider', kind: 'slider-track', what: 'slider-track' },
		],
	},
	{
		page: '/apps/audiocheck/app-settings/access',
		label: 'app-settings-access',
		rows: [
			{ sel: 'form[data-ac-policy-form] input:not([type="hidden"], [type="radio"], [type="checkbox"], [type="range"]), form[data-ac-policy-form] select', kind: 'control-border', what: 'border' },
			{ sel: '.ac-chip__remove, .ac-chip', kind: 'chip', what: 'text+border' },
			{ sel: '.ac-field__hint', kind: 'hint-ink', what: 'text' },
		],
	},
]

async function setUserTheme(page, themeId) {
	const failures = await page.evaluate(async ({ target, all }) => {
		const token = (window.OC && window.OC.requestToken)
			|| document.querySelector('head[data-requesttoken]')?.getAttribute('data-requesttoken') || ''
		const headers = { requesttoken: token, 'OCS-APIRequest': 'true', Accept: 'application/json' }
		const problems = []
		for (const id of all.filter((t) => t !== target)) {
			const res = await fetch(`/ocs/v2.php/apps/theming/api/v1/theme/${id}`, { method: 'DELETE', credentials: 'same-origin', headers })
			if (!res.ok && res.status !== 400) problems.push(`disable ${id}: HTTP ${res.status}`)
		}
		if (target !== 'default') {
			const res = await fetch(`/ocs/v2.php/apps/theming/api/v1/theme/${target}/enable`, { method: 'PUT', credentials: 'same-origin', headers })
			if (!res.ok && res.status !== 400) problems.push(`enable ${target}: HTTP ${res.status}`)
		}
		return problems
	}, { target: themeId, all: THEMES })
	if (failures.length) throw new Error(`theme ${themeId}: ${failures.join(';')}`)
}

async function settle(page) {
	try { await page.waitForLoadState('networkidle', { timeout: 5000 }) } catch { /* long-polls */ }
	await page.locator('#ac-main-content, #ac-denied-main').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {})
	await page.waitForTimeout(400)
}

async function measure(page, probes) {
	const results = []
	for (const p of probes) {
		await page.goto(`${BASE}${p.page}`, { waitUntil: 'domcontentloaded' })
		await settle(page)
		for (const row of p.rows) {
			const found = await page.evaluate(
				async ({ sel, what }) => {
					const els = Array.from(document.querySelectorAll(sel)).filter(
						(n) => n.offsetParent !== null,
					)
					const out = []
					for (const el of els.slice(0, 6)) {
						const cs = getComputedStyle(el)
						const bg = window.__acProbe.effBg(el)
						const outer = window.__acProbe.outerBg(el)
						const item = {
							tag: el.tagName.toLowerCase(),
							cls: (el.getAttribute('class') || '').slice(0, 80),
							fg: cs.color,
							bg,
							outerBg: outer,
							borderColor: cs.borderColor,
							borderWidth: cs.borderWidth,
						}
						if (what === 'slider-track') {
							// Chromium does not expose ::-webkit-slider-runnable-track
							// via getComputedStyle — verify the custom track is active
							// (appearance:none) and measure the token its border paints.
							item.appearance = cs.appearance || cs.webkitAppearance
							const tok = cs.getPropertyValue('--ac-form-border').trim()
							item.trackBorderToken = tok
							item.borderRatio = tok ? window.__acProbe.borderRatio(tok, outer) : null
							const th = getComputedStyle(el, '::-webkit-slider-thumb')
							item.thumbBg = th.backgroundColor
						} else if (what !== 'border') {
							item.textRatio = window.__acProbe.ratio(cs.color, bg)
						}
						if (what !== 'text' && what !== 'slider-track') {
							// WCAG 1.4.11 boundary: the component is identified when
							// EITHER its painted border OR its own fill differs from
							// the adjacent surface by >=3:1. Report both.
							if (parseFloat(cs.borderWidth) > 0
								&& window.__acProbe.alphaOf(cs.borderColor) > 0) {
								item.borderRatio = window.__acProbe.borderRatio(cs.borderColor, outer)
								item.borderAlpha = window.__acProbe.alphaOf(cs.borderColor)
							}
							if (window.__acProbe.alphaOf(cs.backgroundColor) > 0) {
								item.fillRatio = window.__acProbe.ratio(cs.backgroundColor, outer)
							}
						}
						out.push(item)
					}
					return out
				},
				{ sel: row.sel, what: row.what },
			)
			results.push({ page: p.label, kind: row.kind, selector: row.sel, what: row.what, found: found.length, samples: found })
		}
	}
	return results
}

/**
 * Invalid-field paint + danger-button measurement inside the REAL shipped
 * dialog + field-errors path: opens the create-playlist dialog, drives
 * window.CheckFieldErrors.markValidationFields (the exact entry point the
 * API layer calls on a server `fields` map — audiocheck has no live 422
 * fields map today, so this exercises the shipped paint path directly),
 * measures the painted error border + inline error text, then creates and
 * deletes a playlist to measure the real danger confirm button.
 */
async function measureFieldErrorAndDanger(page) {
	const out = { checks: {} }
	await page.goto(`${BASE}/apps/audiocheck/playlists`, { waitUntil: 'domcontentloaded' })
	await settle(page)
	const label = await page.evaluate(() => (typeof window.t === 'function' ? window.t('audiocheck', 'New playlist') : 'New playlist'))
	const trigger = page.locator('button', { hasText: label }).first()
	await trigger.waitFor({ state: 'visible', timeout: 15_000 })
	await trigger.click()
	const dialog = page.locator('dialog.ac-native-dialog')
	await dialog.waitFor({ state: 'visible', timeout: 15_000 })

	// 1) invalid paint: markValidationFields → aria-invalid + .ac-field-error
	out.checks.invalid = await page.evaluate(() => {
		const FE = window.CheckFieldErrors
		if (!FE || typeof FE.markValidationFields !== 'function') return { error: 'CheckFieldErrors missing' }
		FE.install({ prefix: 'ac' })
		FE.markValidationFields({ 'ac-new-playlist-name': 'Required.' })
		const input = document.querySelector('dialog.ac-native-dialog #ac-new-playlist-name')
		const err = document.querySelector('.ac-field-error')
		const res = { ariaInvalid: input && input.getAttribute('aria-invalid') }
		if (err) {
			const cs = getComputedStyle(err)
			res.fieldErrorText = {
				fg: cs.color,
				bg: window.__acProbe.effBg(err),
				textRatio: window.__acProbe.ratio(cs.color, window.__acProbe.effBg(err)),
			}
		}
		if (input) {
			const cs = getComputedStyle(input)
			res.invalidBorder = {
				borderColor: cs.borderColor,
				borderWidth: cs.borderWidth,
				boxShadow: cs.boxShadow,
				bg: window.__acProbe.effBg(input),
				outerBg: window.__acProbe.outerBg(input),
				borderRatio: window.__acProbe.borderRatio(cs.borderColor, window.__acProbe.outerBg(input)),
				fillRatio: window.__acProbe.ratio(cs.backgroundColor, window.__acProbe.outerBg(input)),
			}
		}
		return res
	})

	// 2) real create → delete-confirm → measure .ac-btn--danger → cleanup.
	const name = 'Atlas Contrast Probe ' + Date.now().toString(36)
	await dialog.locator('#ac-new-playlist-name').fill(name)
	await dialog.locator('.ac-modal__actions .ac-btn--primary').click()
	await page.locator('dialog.ac-native-dialog').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
	const delLabel = await page.evaluate(() => (typeof window.t === 'function' ? window.t('audiocheck', 'Delete') : 'Delete'))
	const row = page.locator('.ac-playlist-group', { hasText: name }).first()
	try {
		await row.waitFor({ state: 'visible', timeout: 15_000 })
		if (!(await row.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
			await row.locator('summary').first().click()
		}
		await row.locator('button', { hasText: delLabel }).first().click()
		await dialog.waitFor({ state: 'visible', timeout: 15_000 })
		out.checks.danger = await page.evaluate(() => {
			const btn = document.querySelector('dialog.ac-native-dialog .ac-btn--danger')
			if (!btn) return { error: 'no danger button in confirm dialog' }
			const cs = getComputedStyle(btn)
			const bg = window.__acProbe.effBg(btn)
			return {
				fg: cs.color, bg,
				borderColor: cs.borderColor, borderWidth: cs.borderWidth,
				textRatio: window.__acProbe.ratio(cs.color, bg),
				outerBg: window.__acProbe.outerBg(btn),
				borderRatio: window.__acProbe.borderRatio(cs.borderColor, window.__acProbe.outerBg(btn)),
				fillRatio: window.__acProbe.ratio(cs.backgroundColor, window.__acProbe.outerBg(btn)),
			}
		})
		// confirm delete = cleanup
		await dialog.locator('.ac-btn--danger').click()
		await page.locator('dialog.ac-native-dialog').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
	} catch (e) {
		out.checks.danger = { error: String(e).slice(0, 200) }
	}
	return out
}

async function main() {
	const browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
	const page = await context.newPage()
	const report = { app: 'audiocheck', probe: 'live-computed-contrast', base: BASE, generated_at: new Date().toISOString(), themes: {} }

	try {
		await login(page, { username: USER, password: PASS })
		await context.addInitScript(EVAL_FN)

		for (const theme of THEMES) {
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' })
			await setUserTheme(page, theme)
			const themeRes = { pages: await measure(page, PROBES) }
			if (theme === 'light') {
				themeRes.field_error_and_danger = await measureFieldErrorAndDanger(page)
			}
			report.themes[theme] = themeRes
		}
		await setUserTheme(page, 'default').catch(() => {})
	} finally {
		await context.close()
		await browser.close()
	}

	// Verdict
	const TEXT_MIN = 4.5
	const BORDER_MIN = 3.0
	const findings = []
	for (const [theme, t] of Object.entries(report.themes)) {
		for (const row of t.pages) {
			for (const s of row.samples || []) {
				if (s.textRatio !== undefined && s.textRatio !== null && s.textRatio < TEXT_MIN) {
					findings.push({ theme, page: row.page, kind: row.kind, cls: s.cls, ratio: s.textRatio, min: TEXT_MIN })
				}
				const boundary = Math.max(s.borderRatio || 0, s.fillRatio || 0)
				if ((s.borderRatio !== undefined || s.fillRatio !== undefined) && boundary < BORDER_MIN) {
					findings.push({ theme, page: row.page, kind: row.kind + '-boundary', cls: s.cls, ratio: boundary, min: BORDER_MIN })
				}
			}
		}
		const fe = t.field_error_and_danger && t.field_error_and_danger.checks
		if (fe) {
			const inv = fe.invalid || {}
			if (inv.fieldErrorText && inv.fieldErrorText.textRatio !== null && inv.fieldErrorText.textRatio < TEXT_MIN) {
				findings.push({ theme, page: 'dialog', kind: 'field-error-text', ratio: inv.fieldErrorText.textRatio, min: TEXT_MIN })
			}
			if (inv.invalidBorder) {
				// aria-invalid MUST have a visibly painted error border/ring —
				// the fill fallback does not satisfy the error signal here.
				const iv = inv.invalidBorder
				const painted = (iv.borderRatio !== null && iv.borderRatio >= BORDER_MIN)
					|| (iv.boxShadow && iv.boxShadow !== 'none')
				if (!painted) {
					findings.push({ theme, page: 'dialog', kind: 'invalid-border', ratio: iv.borderRatio, min: BORDER_MIN })
				}
			}
			const dg = fe.danger || {}
			if (dg.textRatio !== undefined && dg.textRatio !== null && dg.textRatio < TEXT_MIN) {
				findings.push({ theme, page: 'dialog', kind: 'danger-text', ratio: dg.textRatio, min: TEXT_MIN })
			}
			const dgBoundary = Math.max(dg.borderRatio || 0, dg.fillRatio || 0)
			if ((dg.borderRatio !== undefined || dg.fillRatio !== undefined) && dgBoundary < BORDER_MIN) {
				findings.push({ theme, page: 'dialog', kind: 'danger-boundary', ratio: dgBoundary, min: BORDER_MIN })
			}
		}
	}
	report.findings = findings
	report.verdict = findings.length === 0 ? 'PASS' : 'FAIL'

	const outIdx = process.argv.indexOf('--out')
	const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null
	if (outPath) {
		mkdirSync(dirname(outPath), { recursive: true })
		writeFileSync(outPath, JSON.stringify(report, null, 2))
		console.log(`wrote ${outPath}`)
	} else {
		console.log(JSON.stringify(report, null, 2).slice(0, 4000))
	}
	console.log(`contrast probe: ${report.verdict} (${findings.length} findings)`)
	process.exit(findings.length > 0 ? 1 : 0)
}

main().catch((e) => {
	console.error(e)
	process.exit(2)
})
