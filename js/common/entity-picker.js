(function () {
	'use strict';

	const C = window.AudioCheckComponents;
	if (!C || !C.createElement) {
		return;
	}

	function bindCombobox(opts) {
		const input = opts.input;
		const suggest = opts.suggest;
		const minLen = typeof opts.minLen === 'number' ? opts.minLen : 2;
		const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 280;
		const ps = opts.strings || {};
		let timer = null;
		let inflight = 0;
		let ar = 0;

		function setSuggestVisible(visible) {
			input.setAttribute('aria-expanded', visible ? 'true' : 'false');
			if (!visible) input.removeAttribute('aria-activedescendant');
		}

		function errMsg(errK) {
			if (errK === 'network') return ps.searchErrorNetwork || null;
			return ps.searchErrorServer || null;
		}

		function setActive(optLis, idx) {
			if (!optLis || !optLis.length) {
				input.removeAttribute('aria-activedescendant');
				return;
			}
			if (typeof idx !== 'number' || idx < 0 || idx >= optLis.length) idx = 0;
			ar = idx;
			for (let i = 0; i < optLis.length; i++) {
				optLis[i].setAttribute('aria-selected', i === ar ? 'true' : 'false');
				if (i === ar) {
					const oid = optLis[i].id;
					if (oid) input.setAttribute('aria-activedescendant', oid);
				}
			}
		}

		function showOpts(items, err, suggestId) {
			suggest.replaceChildren();
			if (err) {
				const pe = errMsg(err);
				if (pe) {
					suggest.appendChild(C.createElement('p', {
						class: 'ac-entity-picker__noresult ac-entity-picker__noresult--err',
						attrs: { role: 'alert' },
						text: pe,
					}));
				}
				suggest.hidden = !suggest.hasChildNodes();
				setSuggestVisible(!suggest.hidden);
				return;
			}
			const pick = (items || []).filter((x) => x && x.id && !opts.isTaken(x.id));
			if (!pick.length) {
				const qv = input.value.trim();
				if ((items && items.length) || qv.length >= minLen) {
					const nr = ps.noResults || '';
					if (nr) {
						suggest.appendChild(C.createElement('p', {
							class: 'ac-entity-picker__noresult',
							attrs: { role: 'status' },
							text: nr,
						}));
					}
				}
				suggest.hidden = !suggest.hasChildNodes();
				setSuggestVisible(!suggest.hidden);
				return;
			}
			const lbId = suggestId + '-lb';
			const listbox = C.createElement('ul', {
				class: 'ac-entity-picker__listbox',
				attrs: { id: lbId, role: 'listbox' },
			});
			input.setAttribute('aria-controls', lbId);
			pick.forEach((it, oi) => {
				const oid = suggestId + '-o' + oi;
				const li = C.createElement('li', {
					attrs: { role: 'option', id: oid, 'aria-selected': oi === 0 ? 'true' : 'false' },
				});
				const dn = it.displayName && String(it.displayName) !== String(it.id) ? String(it.displayName) : '';
				if (dn) {
					li.appendChild(C.createElement('div', { class: 'ac-entity-suggest__line', text: dn }));
					li.appendChild(C.createElement('div', { class: 'ac-entity-suggest__id', text: String(it.id) }));
				} else {
					li.appendChild(C.createElement('div', { class: 'ac-entity-suggest__line', text: String(it.id) }));
				}
				li.addEventListener('mousedown', (ev) => {
					if (ev.button !== 0) return;
					ev.preventDefault();
					opts.onPick({ id: String(it.id), displayName: String(it.displayName || it.id) });
					suggest.replaceChildren();
					suggest.hidden = true;
					setSuggestVisible(false);
					input.value = '';
					input.focus();
				});
				listbox.appendChild(li);
			});
			suggest.appendChild(listbox);
			suggest.hidden = false;
			setSuggestVisible(true);
			setActive(Array.from(listbox.querySelectorAll('li[role="option"]')), 0);
		}

		function onInput() {
			if (timer) window.clearTimeout(timer);
			inflight += 1;
			const v = input.value.trim();
			if (v.length < minLen) {
				suggest.replaceChildren();
				suggest.hidden = true;
				setSuggestVisible(false);
				return;
			}
			const my = inflight;
			timer = window.setTimeout(async () => {
				let result = { items: [], error: null };
				try {
					result = await opts.fetchItems(v);
				} catch (_) {
					result = { items: [], error: 'server' };
				}
				if (my !== inflight) return;
				showOpts(result.items || [], result.error || null, suggest.id);
			}, debounceMs);
		}

		function onKeydown(e) {
			const optLis = suggest.hidden ? [] : Array.from(suggest.querySelectorAll('li[role="option"]'));
			if (e.key === 'Enter') {
				e.preventDefault();
				if (optLis.length) (optLis[ar] || optLis[0]).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
				return;
			}
			if (e.key === 'Escape' && !suggest.hidden) {
				e.preventDefault();
				suggest.replaceChildren();
				suggest.hidden = true;
				setSuggestVisible(false);
				return;
			}
			if (!optLis.length) return;
			if (e.key === 'ArrowDown') { e.preventDefault(); setActive(optLis, (ar + 1) % optLis.length); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(optLis, (ar - 1 + optLis.length) % optLis.length); }
		}

		function onBlur() {
			window.setTimeout(() => {
				if (suggest.contains(document.activeElement) || document.activeElement === input) return;
				suggest.replaceChildren();
				suggest.hidden = true;
				setSuggestVisible(false);
			}, 150);
		}

		input.setAttribute('role', 'combobox');
		input.setAttribute('aria-autocomplete', 'list');
		input.setAttribute('aria-haspopup', 'listbox');
		input.setAttribute('aria-expanded', 'false');
		input.addEventListener('input', onInput);
		input.addEventListener('keydown', onKeydown);
		input.addEventListener('blur', onBlur);

		return () => {
			input.removeEventListener('input', onInput);
			input.removeEventListener('keydown', onKeydown);
			input.removeEventListener('blur', onBlur);
			if (timer) window.clearTimeout(timer);
		};
	}

	window.AudioCheckEntityPicker = { bindCombobox };
})();
