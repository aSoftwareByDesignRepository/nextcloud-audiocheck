(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const PAGE_SIZE = 48;

	function collectionView(viewId, kind, title, help) {
		AudioCheckRouter.register(viewId, {
			render() {
				const frag = document.createDocumentFragment();
				frag.appendChild(C.pageHeader(title, help));

				let sort = 'title';
				let query = '';
				let page = 1;
				let total = 0;
				let timer = null;

				const toolbar = C.el('div', { className: 'ac-toolbar ac-collection-toolbar' });
				const search = C.el('input', {
					type: 'search',
					className: 'ac-input ac-collection-toolbar__search',
					attrs: {
						'aria-label': t('audiocheck', 'Search collections…'),
						placeholder: t('audiocheck', 'Search collections…'),
						autocomplete: 'off',
					},
				});
				const sortSel = C.el('select', {
					className: 'ac-input ac-collection-toolbar__sort',
					attrs: { 'aria-label': t('audiocheck', 'Sort by') },
				});
				[
					{ v: 'title', l: t('audiocheck', 'Title') },
					{ v: 'artist', l: t('audiocheck', 'Artist') },
					{ v: 'added', l: t('audiocheck', 'Recently added') },
					{ v: 'played', l: t('audiocheck', 'Recently played') },
				].forEach((opt) => {
					sortSel.appendChild(C.el('option', { value: opt.v, text: opt.l }));
				});

				toolbar.appendChild(search);
				toolbar.appendChild(sortSel);
				frag.appendChild(toolbar);

				const grid = C.el('div', { className: 'ac-grid' });
				const status = C.el('p', {
					className: 'ac-field__hint',
					attrs: { role: 'status', 'aria-live': 'polite' },
				});
				const moreWrap = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-collection-more' });
				frag.appendChild(status);
				frag.appendChild(grid);
				frag.appendChild(moreWrap);

				function appendItems(items) {
					items.forEach((c) => grid.appendChild(C.mediaCard({
						title: c.title,
						subtitle: c.subtitle,
						coverFileId: c.coverFileId,
					}, () => {
						if (PA()) PA().openCollectionDetail(c.key, c.title);
					})));
				}

				function updateMoreButton() {
					moreWrap.textContent = '';
					if (grid.children.length < total) {
						const btn = C.el('button', {
							type: 'button',
							className: 'ac-btn ac-btn--primary',
							text: t('audiocheck', 'Load more'),
							onClick: () => {
								page += 1;
								fetchPage(false);
							},
						});
						moreWrap.appendChild(btn);
					}
				}

				function fetchPage(reset) {
					if (reset) {
						page = 1;
						grid.textContent = '';
					}
					status.textContent = '…';
					const params = { kind, limit: PAGE_SIZE, page, sort };
					if (query.length >= 2) params.q = query;
					AudioCheckApi.get('/apps/audiocheck/api/collections', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							grid.textContent = '';
							moreWrap.textContent = '';
							status.textContent = query.length >= 2
								? t('audiocheck', 'No matching collections.')
								: '';
							grid.appendChild(C.emptyState(
								t('audiocheck', 'Nothing here yet'),
								kind === 'audiobook'
									? t('audiocheck', 'Audiobooks are detected from .m4b files, long tracks, or audiobook genres. Add audio folders in Library and scan.')
									: t('audiocheck', 'Music is grouped by album from your scanned folders. Add a folder in Library, then scan.'),
								{
									icon: kind === 'music' ? 'music' : 'audiobook',
									ctaLabel: t('audiocheck', 'Open Library'),
									onCta: () => AudioCheckRouter.navigate('library', {}, true),
								},
							));
							return;
						}
						status.textContent = t('audiocheck', 'Showing {shown} of {total} collections', {
							shown: String(grid.children.length + items.length),
							total: String(total),
						});
						appendItems(items);
						updateMoreButton();
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				search.addEventListener('input', () => {
					clearTimeout(timer);
					query = search.value.trim();
					timer = setTimeout(() => fetchPage(true), 300);
				});
				sortSel.addEventListener('change', () => {
					sort = sortSel.value;
					fetchPage(true);
				});

				fetchPage(true);
				return frag;
			},
		});
	}

	collectionView('audiobooks', 'audiobook', t('audiocheck', 'Audiobooks'), t('audiocheck', 'Browse your audiobook collections.'));
	collectionView('music', 'music', t('audiocheck', 'Music'), t('audiocheck', 'Browse albums and artists.'));
})();
