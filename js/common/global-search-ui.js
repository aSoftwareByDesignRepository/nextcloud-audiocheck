(function () {
	'use strict';

	const GS = () => window.AudioCheckGlobalSearch;
	const C = () => window.AudioCheckComponents;

	let host = null;
	let input = null;
	let unsubRouter = null;

	function syncVisibility(viewId) {
		if (!host) return;
		const show = GS() && GS().isActiveView(viewId);
		host.hidden = !show;
		host.setAttribute('aria-hidden', show ? 'false' : 'true');
	}

	function mount() {
		host = document.getElementById('ac-global-search');
		if (!host || host.dataset.acReady || !GS() || !C()) return;
		host.dataset.acReady = '1';

		const wrap = C().el('div', { className: 'ac-global-search__inner' });
		input = C().el('input', {
			type: 'search',
			id: 'ac-global-search-input',
			className: 'ac-input ac-global-search__input',
			attrs: {
				'aria-label': t('audiocheck', 'Search your library'),
				placeholder: t('audiocheck', 'Search your library'),
				autocomplete: 'off',
				value: GS().getQuery(),
			},
		});
		const clearBtn = C().el('button', {
			type: 'button',
			className: 'ac-btn ac-btn--text ac-global-search__clear',
			text: t('audiocheck', 'Clear search'),
			attrs: { hidden: !GS().getQuery() },
			onClick: () => {
				GS().clear();
				if (input) {
					input.value = '';
					input.focus();
				}
			},
		});

		input.addEventListener('input', () => {
			GS().setQuery(input.value);
			clearBtn.hidden = !input.value;
		});

		GS().subscribe((state) => {
			if (input && input.value !== state.query) input.value = state.query;
			clearBtn.hidden = !state.query;
		});

		wrap.appendChild(input);
		wrap.appendChild(clearBtn);
		host.appendChild(wrap);

		document.addEventListener('audiocheck-view-change', (ev) => {
			const viewId = ev.detail && ev.detail.viewId;
			if (viewId) syncVisibility(viewId);
		});

		const initialView = window.AudioCheckRouter?.getCurrentView?.()
			|| document.getElementById('ac-main')?.dataset?.acView
			|| document.getElementById('app-content')?.dataset?.acView
			|| 'home';
		syncVisibility(initialView);
	}

	window.AudioCheckGlobalSearchUi = { mount };
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mount);
	} else {
		mount();
	}
})();
