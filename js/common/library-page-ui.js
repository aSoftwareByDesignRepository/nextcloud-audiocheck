(function () {
	'use strict';

	const C = AudioCheckComponents;

	function sectionHeading(text, id) {
		return C.el('h2', {
			className: 'ac-section__title',
			text,
			attrs: id ? { id } : {},
		});
	}

	/**
	 * @param {object} opts
	 * @param {string} opts.sort
	 * @param {Array<{v:string,l:string}>} opts.options
	 * @param {string} [opts.groupLabel]
	 * @param {(sort: string) => void} opts.onChange
	 */
	function buildSortChipRow(opts) {
		const wrap = C.el('div', { className: 'ac-library-filters__group' });
		if (opts.groupLabel) {
			wrap.appendChild(C.el('p', {
				className: 'ac-library-filters__label',
				text: opts.groupLabel,
			}));
		}
		const row = C.el('div', {
			className: 'ac-chip-row ac-library-sort',
			attrs: {
				role: 'group',
				'aria-label': opts.groupLabel || t('audiocheck', 'Sort by'),
			},
		});
		(opts.options || []).forEach((opt) => {
			row.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-filter-chip' + (opts.sort === opt.v ? ' ac-filter-chip--active' : ''),
				text: opt.l,
				attrs: {
					'data-sort': opt.v,
					'aria-pressed': opts.sort === opt.v ? 'true' : 'false',
				},
				onClick: () => {
					if (opts.sort === opt.v) return;
					opts.onChange(opt.v);
				},
			}));
		});
		wrap.appendChild(row);
		return wrap;
	}

	function buildHideListenedFilter(opts) {
		const chip = C.el('button', {
			type: 'button',
			className: 'ac-filter-chip ac-filter-chip--toggle' + (opts.checked ? ' ac-filter-chip--active' : ''),
			text: t('audiocheck', 'Hide listened'),
			attrs: {
				'aria-pressed': opts.checked ? 'true' : 'false',
			},
			onClick: () => {
				const next = !opts.checked;
				opts.checked = next;
				chip.setAttribute('aria-pressed', next ? 'true' : 'false');
				chip.classList.toggle('ac-filter-chip--active', next);
				opts.onChange(next);
			},
		});
		return C.el('div', { className: 'ac-library-filters__group' }, [
			C.el('p', {
				className: 'ac-library-filters__label',
				text: t('audiocheck', 'Display'),
			}),
			C.el('div', {
				className: 'ac-chip-row ac-library-display',
				attrs: { role: 'group', 'aria-label': t('audiocheck', 'Display') },
			}, [chip]),
		]);
	}

	function buildSearchHint(getQuery) {
		const el = C.el('p', {
			className: 'ac-library-search-hint',
			attrs: { role: 'status', 'aria-live': 'polite', hidden: true },
		});
		function refresh() {
			const q = typeof getQuery === 'function' ? getQuery() : '';
			if (q) {
				el.hidden = false;
				el.textContent = t('audiocheck', 'Filtering by “{query}”. Use the search bar above to change it.', { query: q });
			} else {
				el.hidden = true;
				el.textContent = '';
			}
		}
		refresh();
		el.refresh = refresh;
		return el;
	}

	function createContentShell(ariaLabel) {
		return C.el('section', {
			className: 'ac-card ac-section ac-library-shell',
			attrs: { 'aria-label': ariaLabel || t('audiocheck', 'Library content') },
		});
	}

	function defaultSortOptions(artistLabel) {
		return [
			{ v: 'title', l: t('audiocheck', 'Title') },
			{ v: 'artist', l: artistLabel || t('audiocheck', 'Artist') },
			{ v: 'added', l: t('audiocheck', 'Recently added') },
			{ v: 'played', l: t('audiocheck', 'Recently played') },
		];
	}

	window.AudioCheckLibraryPageUi = {
		sectionHeading,
		buildSortChipRow,
		buildHideListenedFilter,
		buildSearchHint,
		createContentShell,
		defaultSortOptions,
	};
})();
