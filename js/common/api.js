(function () {
	'use strict';
	const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

	function csrf() {
		if (window.OC && OC.requestToken) return OC.requestToken;
		const el = document.querySelector('input[name="requesttoken"]');
		return el ? el.value : '';
	}

	function routeParamKeys(path) {
		const keys = new Set();
		const re = /\{(\w+)\}/g;
		let match;
		while ((match = re.exec(path)) !== null) {
			keys.add(match[1]);
		}
		return keys;
	}

	function buildUrl(path, params) {
		const routeKeys = routeParamKeys(path);
		const routeParams = {};
		const query = new URLSearchParams();
		Object.entries(params || {}).forEach(([key, value]) => {
			if (value === undefined || value === null || value === '') return;
			if (routeKeys.has(key)) {
				routeParams[key] = value;
				return;
			}
			if (Array.isArray(value)) {
				value.forEach((entry) => query.append(key + '[]', String(entry)));
			} else {
				query.append(key, String(value));
			}
		});
		const base = OC.generateUrl(path, routeParams);
		const suffix = query.toString();
		return suffix ? base + '?' + suffix : base;
	}

	function mergeParams(params, options) {
		return Object.assign({}, options && options.params, params || {});
	}

	/**
	 * The server intentionally sends machine codes (e.g. "internal_error") for
	 * non-validation failures; translate them here so users never see raw
	 * snake_case codes in toasts. Validation errors carry a descriptive,
	 * human-readable message which is passed through unchanged.
	 */
	function friendlyErrorMessage(status, code, serverMessage) {
		const byCode = {
			not_authenticated: t('audiocheck', 'Your session has expired. Reload the page to sign in again.'),
			access_denied: t('audiocheck', 'You do not have permission to do this.'),
			not_found: t('audiocheck', 'The requested item could not be found.'),
			rate_limit_exceeded: t('audiocheck', 'Too many requests. Please wait a moment and try again.'),
			internal_error: t('audiocheck', 'Something went wrong on the server. Please try again.'),
		};
		if (code && byCode[code]) return byCode[code];
		if (serverMessage && serverMessage !== code) return serverMessage;
		if (status >= 500) return byCode.internal_error;
		return t('audiocheck', 'Request failed.');
	}

	async function request(path, options) {
		const opts = options || {};
		const method = (opts.method || 'GET').toUpperCase();
		const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
		if (MUTATION.has(method)) {
			const token = csrf();
			if (!token) throw Object.assign(new Error(t('audiocheck', 'Missing CSRF request token.')), { status: 0 });
			headers.requesttoken = token;
		}
		if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
		let response;
		try {
			response = await fetch(buildUrl(path, opts.params), {
				method,
				credentials: 'same-origin',
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
				signal: opts.signal,
			});
		} catch (cause) {
			// Aborts must propagate untouched so callers can ignore them;
			// everything else is a connectivity problem the user can act on.
			if (cause && cause.name === 'AbortError') throw cause;
			const err = new Error(t('audiocheck', 'Could not reach the server. Check your connection and try again.'));
			err.status = 0;
			err.cause = cause;
			throw err;
		}
		const json = (response.headers.get('content-type') || '').includes('json');
		let data;
		if (json) {
			try {
				data = await response.json();
			} catch (_) {
				throw Object.assign(
					new Error(t('audiocheck', 'Unexpected server response. Please try again.')),
					{ status: response.status },
				);
			}
		} else {
			data = await response.text();
		}
		if (!response.ok) {
			const code = (data && data.error && data.error.code) || '';
			const err = new Error(friendlyErrorMessage(response.status, code, data && data.message));
			err.status = response.status;
			err.payload = data;
			err.code = code;
			throw err;
		}
		return data;
	}

	function scanNeedsAjaxCronTick(scan) {
		return !!scan && scan.backgroundCron === false
			&& (scan.status === 'queued' || scan.status === 'running');
	}

	window.AudioCheckApi = {
		scanNeedsAjaxCronTick,
		runAjaxScanTick(scan) {
			if (!scanNeedsAjaxCronTick(scan)) return Promise.resolve(null);
			return request('/apps/audiocheck/api/scan/ajax-cron').then((r) => r.scan || null).catch(() => null);
		},
		fetchScanStatus(scanHint) {
			const load = () => this.get('/apps/audiocheck/api/scan').then((r) => r.scan);
			if (scanNeedsAjaxCronTick(scanHint)) {
				return this.runAjaxScanTick(scanHint).then((ticked) => ticked || load());
			}
			return load().then((scan) => {
				if (!scanNeedsAjaxCronTick(scan)) return scan;
				return this.runAjaxScanTick(scan).then((ticked) => ticked || scan);
			});
		},
		get: (path, params, options) => request(path, Object.assign({}, options || {}, { method: 'GET', params: mergeParams(params, options) })),
		post: (path, body, options) => request(path, Object.assign({}, options || {}, { method: 'POST', body, params: mergeParams(null, options) })),
		put: (path, body, options) => request(path, Object.assign({}, options || {}, { method: 'PUT', body, params: mergeParams(null, options) })),
		del: (path, body, options) => request(path, Object.assign({}, options || {}, { method: 'DELETE', body, params: mergeParams(null, options) })),
		request,
		validFileId(value) {
			const id = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
			return Number.isFinite(id) && id > 0 ? id : null;
		},
		streamUrl(fileId) {
			const id = this.validFileId(fileId);
			if (!id) return '';
			return OC.generateUrl('/apps/audiocheck/api/stream/{fileId}', { fileId: id });
		},
		coverUrl(fileId) {
			const id = this.validFileId(fileId);
			if (!id) return '';
			return OC.generateUrl('/apps/audiocheck/api/cover/{fileId}', { fileId: id });
		},
	};
})();
