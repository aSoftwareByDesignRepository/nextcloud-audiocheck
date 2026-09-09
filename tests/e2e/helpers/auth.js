async function login(page, { username, password }) {
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	if (!page.url().includes('/login')) {
		return;
	}
	const userInput = page.locator('input#user, input[name="user"]').first();
	const passInput = page.locator('input#password, input[name="password"]').first();
	try {
		await userInput.waitFor({ state: 'visible', timeout: 30_000 });
	} catch {
		if (!page.url().includes('/login')) {
			return;
		}
		throw new Error('Login form not ready (Vue #login)');
	}
	await userInput.fill(username);
	await passInput.fill(password);
	await page.locator('button[type="submit"], input[type="submit"]').first().click();
	await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
	await page.waitForLoadState('domcontentloaded');
}

function credsFromEnv(role) {
	const u = process.env[`NC_${role}_USER`] || process.env.E2E_USER;
	const p = process.env[`NC_${role}_PASS`]
		|| process.env[`NC_${role}_PASSWORD`]
		|| process.env.E2E_PASSWORD
		|| process.env.E2E_PASS;
	if (!u || !p) {
		throw new Error(`Missing env vars for role ${role} (NC_* / E2E_*)`);
	}
	return { username: u, password: p };
}

/**
 * Prefer explicit E2E_USER when set so stale NC_ADMIN_* on shared farms
 * cannot hijack gauntlet login.
 */
function resolveE2eCreds(preferredRole = 'ADMIN') {
	if (process.env.E2E_USER && (process.env.E2E_PASSWORD || process.env.E2E_PASS)) {
		return {
			username: process.env.E2E_USER,
			password: process.env.E2E_PASSWORD || process.env.E2E_PASS,
		};
	}
	return credsFromEnv(preferredRole);
}

module.exports = { login, credsFromEnv, resolveE2eCreds };
