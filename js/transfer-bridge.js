/**
 * Bridge for the shared transfer page (apps/_shared/config-transfer):
 * gives window.AudioCheckApi the .url/.upload surface the synced
 * js/transfer.js expects and unwraps the transfer API's
 * {success:true,data:…} envelope — the app's own endpoints answer
 * {ok:true,…} and are passed through untouched, so every existing caller
 * keeps its current shapes (errors included). App-specific — not synced.
 */
(function () {
	'use strict';
	const api = window.AudioCheckApi || (window.AudioCheckApi = {});

	function requestToken() {
		return (window.OC && OC.requestToken) || '';
	}

	// Transfer endpoints wrap their payload in {success:true,data:…};
	// app endpoints already carry fields top-level under {ok:true,…}.
	function unwrap(j) {
		return j && j.success === true && Object.prototype.hasOwnProperty.call(j, 'data') ? j.data : j;
	}

	// Transfer errors carry {success:false,error:'CODE',context:…} — the
	// app api layer only understands {error:{code}} and would surface ''
	// as code; copy code+context onto the thrown error so the synced
	// errText() can map them.
	function enrich(err) {
		const j = err && err.payload;
		if (j && j.success === false) {
			if (typeof j.error === 'string' && j.error !== '') {
				err.code = j.error;
			}
			err.context = j.context || {};
		}
		throw err;
	}

	function parse(resp) {
		return resp.json().catch(() => null).then((j) => {
			if (!resp.ok || (j && (j.ok === false || j.success === false))) {
				const errObj = j && j.error;
				const code = (errObj && (errObj.code || (typeof errObj === 'string' ? errObj : null))) || 'SERVER_ERROR';
				const err = new Error((j && j.message) || code);
				err.status = resp.status;
				err.payload = j;
				err.code = code;
				err.context = (j && j.context) || {};
				throw err;
			}
			return unwrap(j);
		});
	}

	const innerGet = api.get ? api.get.bind(api) : null;
	const innerPost = api.post ? api.post.bind(api) : null;

	api.url = function (path) {
		return OC.generateUrl('/apps/audiocheck' + path);
	};
	if (innerGet) {
		api.get = function (path, params, options) {
			return innerGet(path, params, options).then(unwrap, enrich);
		};
	}
	if (innerPost) {
		api.post = function (path, body, options) {
			return innerPost(path, body, options).then(unwrap, enrich);
		};
	}
	api.upload = function (path, file, extra) {
		const fd = new FormData();
		fd.append('file', file);
		if (extra) {
			Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
		}
		return fetch(api.url(path), {
			method: 'POST',
			credentials: 'same-origin',
			headers: { requesttoken: requestToken() },
			body: fd,
		}).then(parse, () => { throw { code: 'NETWORK_ERROR', context: {} }; });
	};

	const msg = window.AudioCheckMessaging || (window.AudioCheckMessaging = {});
	if (!msg.alert) {
		msg.alert = function (text) {
			if (typeof msg.toast === 'function') { msg.toast(text, 'error'); return; }
			const el = document.getElementById('ac-transfer-result-live');
			if (el) el.textContent = text;
		};
	}
	if (!msg.polite) {
		msg.polite = function (text) {
			if (typeof msg.toast === 'function') { msg.toast(text, 'info'); return; }
			msg.alert(text);
		};
	}
})();
