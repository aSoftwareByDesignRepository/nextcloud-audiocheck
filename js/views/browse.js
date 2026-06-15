(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;

	AudioCheckRouter.register('browse', {
		render() {
			const frag = document.createDocumentFragment();
			frag.appendChild(C.pageHeader(t('audiocheck', 'Browse'), t('audiocheck', 'Explore artists, genres, and folders.')));

			const tabs = [
				{ id: 'artists', label: t('audiocheck', 'Artists') },
				{ id: 'authors', label: t('audiocheck', 'Authors') },
				{ id: 'series', label: t('audiocheck', 'Series') },
				{ id: 'genres', label: t('audiocheck', 'Genres') },
				{ id: 'folders', label: t('audiocheck', 'Folders') },
				{ id: 'favorites', label: t('audiocheck', 'Favorites') },
				{ id: 'tags', label: t('audiocheck', 'Tags') },
			];
			let active = 'artists';
			const tabBar = C.el('div', { className: 'ac-browse-tabs', role: 'tablist', attrs: { 'aria-label': t('audiocheck', 'Browse categories') } });
			const panel = C.el('div', {
				id: 'ac-browse-panel',
				attrs: {
					role: 'tabpanel',
					'aria-labelledby': 'ac-browse-tab-artists',
				},
			});

			function facetTrackParams(type, item) {
				const params = { limit: 100 };
				if (type === 'favorites') {
					params.favorite = '1';
				} else if (type === 'tags' && item.id) {
					params.tagId = item.id;
				} else if (type === 'genres') {
					params.genre = item.name;
				} else if (type === 'artists') {
					params.artist = item.name;
					params.kind = 'music';
				} else if (type === 'authors') {
					params.artist = item.name;
					params.kind = 'audiobook';
				} else if (type === 'series') {
					params.series = item.name;
				} else if (type === 'folders') {
					params.folder = item.name;
				}
				return params;
			}

			function openFacetTracks(label, params) {
				if (PA()) PA().openTrackListFromApi(label, params);
			}

			function loadFacet(type) {
				panel.textContent = '';
				panel.setAttribute('aria-labelledby', 'ac-browse-tab-' + type);
				const loading = C.el('p', { text: '…', attrs: { role: 'status', 'aria-live': 'polite' } });
				panel.appendChild(loading);
				AudioCheckApi.get('/apps/audiocheck/api/facets/{type}', null, { params: { type } }).then((data) => {
					panel.textContent = '';
					const ul = C.el('ul', { className: 'ac-track-list ac-browse-facet-list' });
					const items = data.items || [];
					if (!items.length) {
						panel.appendChild(C.el('p', { text: t('audiocheck', 'Nothing here yet') }));
						return;
					}
					items.forEach((item) => {
						const label = type === 'favorites'
							? t('audiocheck', 'Favorites') + ' (' + item.count + ')'
							: item.name + ' (' + item.count + ')';
						const li = C.el('li', { className: 'ac-track-list__item ac-browse-facet-list__item' });
						const btn = C.el('button', {
							type: 'button',
							className: 'ac-btn ac-btn--text ac-browse-facet-list__btn',
							text: label,
							attrs: { 'aria-label': t('audiocheck', 'Open tracks: {name}', { name: item.name || label }) },
							onClick: () => openFacetTracks(label, facetTrackParams(type, item)),
						});
						li.appendChild(btn);
						ul.appendChild(li);
					});
					panel.appendChild(ul);
				}).catch((e) => {
					panel.textContent = '';
					panel.appendChild(C.el('p', { text: e.message || t('audiocheck', 'Request failed.') }));
				});
			}

			tabs.forEach((tab) => {
				const btn = C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: tab.label,
					attrs: {
						role: 'tab',
						id: 'ac-browse-tab-' + tab.id,
						'aria-controls': 'ac-browse-panel',
						'aria-selected': tab.id === active ? 'true' : 'false',
						tabindex: tab.id === active ? '0' : '-1',
					},
					onClick: () => {
						active = tab.id;
						tabBar.querySelectorAll('button').forEach((b) => {
							const on = b.id === 'ac-browse-tab-' + tab.id;
							b.setAttribute('aria-selected', on ? 'true' : 'false');
							b.setAttribute('tabindex', on ? '0' : '-1');
						});
						loadFacet(tab.id);
					},
				});
				tabBar.appendChild(btn);
			});

			frag.appendChild(tabBar);
			frag.appendChild(panel);
			loadFacet(active);
			return frag;
		},
	});
})();
