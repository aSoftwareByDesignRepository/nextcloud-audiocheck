(function () {
	'use strict';

	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const UIL = () => window.AudioCheckTrackListUi;
	const PAGE_SIZE = 48;
	const PLAY_ALL_PAGE_SIZE = 100;
	const PLAY_ALL_MAX_TRACKS = 500;

	function displayFolderLabel(path) {
		if (!path) return t('audiocheck', 'Folder');
		const parts = String(path).split('/').filter(Boolean);
		if (parts.length >= 2 && parts[0] === 'files') {
			parts.shift();
		}
		return parts.join(' / ') || String(path);
	}

	function trackDisplayMeta(track) {
		if (track.artist) return track;
		const path = track.relPath || '';
		const slash = path.lastIndexOf('/');
		if (slash > 0) return { ...track, artist: displayFolderLabel(path.slice(0, slash)) };
		return track;
	}

	/**
	 * @param {object} config
	 * @param {string} config.viewId
	 * @param {string} config.kind
	 * @param {string} config.title
	 * @param {string} config.help
	 * @param {string} config.viewsAriaLabel
	 * @param {string} config.playAllKindLabel
	 * @param {Array<{id:string,label:string}>} config.tabs
	 * @param {Record<string,string>} config.tabLeads
	 * @param {string} config.emptyTracks
	 * @param {string} config.emptyAlbums
	 * @param {string} config.emptyFolders
	 * @param {string} [config.sortArtistLabel]
	 * @param {string} [config.emptyIcon]
	 * @param {string} [config.idPrefix]
	 */
	function registerMediaLibraryPage(config) {
		const idPrefix = config.idPrefix || ('ac-' + config.viewId);
		const emptyIcon = config.emptyIcon || 'music';
		const sortArtistLabel = config.sortArtistLabel || t('audiocheck', 'Artist');

		AudioCheckRouter.register(config.viewId, {
			render() {
				const frag = document.createDocumentFragment();
				const body = C.el('div', { className: 'ac-page-body ac-media-library-page ac-facet-browse-page' });

				let activeTab = config.tabs[0].id;
				let sort = 'title';
				let query = '';
				let page = 1;
				let total = 0;
				let timer = null;
				let tabButtons = [];
				let panel = null;
				let toolbar = null;
				let leadEl = null;
				let status = null;
				let moreWrap = null;
				let playableCache = [];

				const playAllBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--primary',
					text: t('audiocheck', 'Play all'),
					attrs: { 'aria-label': t('audiocheck', 'Play all {kind}', { kind: config.playAllKindLabel }) },
					onClick: () => playAllTracks(),
				});

				async function playAllTracks() {
					playAllBtn.disabled = true;
					try {
						const baseParams = { kind: config.kind, sort, limit: PLAY_ALL_PAGE_SIZE };
						if (query.length >= 2) baseParams.q = query;
						const tracks = [];
						let pageNum = 1;
						let totalTracks = Infinity;
						while (tracks.length < totalTracks && tracks.length < PLAY_ALL_MAX_TRACKS) {
							const data = await AudioCheckApi.get('/apps/audiocheck/api/tracks', { ...baseParams, page: pageNum });
							const batch = data.items || [];
							batch.forEach((tr) => {
								if (tr && !tr.unavailable) tracks.push(tr);
							});
							totalTracks = data.total != null ? data.total : tracks.length;
							if (batch.length < PLAY_ALL_PAGE_SIZE) break;
							pageNum += 1;
						}
						if (!tracks.length) {
							AudioCheckMessaging.toast(t('audiocheck', 'Nothing here yet'), 'warning');
							return;
						}
						if (totalTracks > PLAY_ALL_MAX_TRACKS) {
							AudioCheckMessaging.toast(
								t('audiocheck', 'Playing first {count} tracks.', { count: String(tracks.length) }),
								'info',
							);
						}
						AudioCheckPlayer.playQueue(tracks, 0);
						AudioCheckRouter.navigate('now-playing', {}, true);
					} catch (e) {
						AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
					} finally {
						playAllBtn.disabled = false;
					}
				}

				function setActiveTab(type) {
					activeTab = type;
					tabButtons.forEach((btn) => {
						const on = btn.dataset.tabId === type;
						btn.setAttribute('aria-selected', on ? 'true' : 'false');
						btn.setAttribute('tabindex', on ? '0' : '-1');
					});
					if (panel) panel.setAttribute('aria-labelledby', idPrefix + '-tab-' + type);
					if (leadEl && config.tabLeads[type]) {
						leadEl.textContent = config.tabLeads[type];
					}
				}

				function focusTabByOffset(offset) {
					const idx = tabButtons.findIndex((btn) => btn.dataset.tabId === activeTab);
					if (idx < 0) return;
					const next = tabButtons[(idx + offset + tabButtons.length) % tabButtons.length];
					next.focus();
					loadTab(next.dataset.tabId);
				}

				function updateToolbar(tabId) {
					if (!toolbar) return;
					toolbar.replaceChildren();
					const searchLabel = tabId === 'albums'
						? t('audiocheck', 'Search collections…')
						: tabId === 'folders'
							? t('audiocheck', 'Filter folders…')
							: t('audiocheck', 'Search tracks…');
					const search = C.el('input', {
						type: 'search',
						className: 'ac-input ac-collection-toolbar__search',
						attrs: {
							id: idPrefix + '-search',
							'aria-label': searchLabel,
							placeholder: searchLabel,
							autocomplete: 'off',
							value: query,
						},
					});
					search.addEventListener('input', () => {
						clearTimeout(timer);
						query = search.value.trim();
						timer = setTimeout(() => loadTab(tabId, true), 300);
					});
					toolbar.appendChild(search);

					if (tabId !== 'folders') {
						const sortSel = C.el('select', {
							className: 'ac-input ac-collection-toolbar__sort',
							attrs: { 'aria-label': t('audiocheck', 'Sort by') },
						});
						[
							{ v: 'title', l: t('audiocheck', 'Title') },
							{ v: 'artist', l: sortArtistLabel },
							{ v: 'added', l: t('audiocheck', 'Recently added') },
							{ v: 'played', l: t('audiocheck', 'Recently played') },
						].forEach((opt) => {
							sortSel.appendChild(C.el('option', {
								value: opt.v,
								text: opt.l,
								attrs: opt.v === sort ? { selected: true } : {},
							}));
						});
						sortSel.addEventListener('change', () => {
							sort = sortSel.value;
							loadTab(tabId, true);
						});
						toolbar.appendChild(sortSel);
					}
				}

				function showEmpty(message, icon, extraCta) {
					panel.replaceChildren();
					moreWrap.textContent = '';
					status.textContent = '';
					panel.appendChild(C.emptyState(
						t('audiocheck', 'Nothing here yet'),
						message,
						{
							icon: icon || emptyIcon,
							ctaLabel: extraCta ? extraCta.label : t('audiocheck', 'Open Library'),
							onCta: extraCta ? extraCta.onClick : () => AudioCheckRouter.navigate('library', {}, true),
						},
					));
				}

				function appendTracksToList(list, tracks, cache) {
					UIL().appendTracksToList(list, tracks, cache, C, trackDisplayMeta);
				}

				function loadTracks(reset) {
					if (reset) {
						page = 1;
						playableCache = [];
						panel.replaceChildren();
						panel.appendChild(C.el('ul', { className: 'ac-track-list', id: idPrefix + '-track-list' }));
					}
					const list = panel.querySelector('#' + idPrefix + '-track-list');
					if (!list) return;
					status.textContent = t('audiocheck', 'Loading…');
					moreWrap.textContent = '';
					const params = { kind: config.kind, limit: PAGE_SIZE, page, sort };
					if (query.length >= 2) params.q = query;
					AudioCheckApi.get('/apps/audiocheck/api/tracks', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							showEmpty(query.length >= 2
								? t('audiocheck', 'No matching tracks.')
								: config.emptyTracks);
							return;
						}
						appendTracksToList(list, items, playableCache);
						status.textContent = t('audiocheck', 'Showing {shown} of {total} tracks', {
							shown: String(list.children.length),
							total: String(total),
						});
						if (list.children.length < total) {
							moreWrap.appendChild(C.el('button', {
								type: 'button',
								className: 'ac-btn ac-btn--primary',
								text: t('audiocheck', 'Load more'),
								onClick: () => { page += 1; loadTracks(false); },
							}));
						}
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				function renderFolderGroup(item, host, startOpen) {
					const folderPath = item.name || '';
					const count = item.count || 0;
					const label = displayFolderLabel(folderPath);
					const trackParams = () => ({
						folder: folderPath,
						kind: config.kind,
						limit: UIL().FACET_TRACK_LIMIT,
						sort,
					});

					UIL().renderExpandableTrackGroup({
						C,
						label,
						count,
						host,
						startOpen,
						displayMeta: trackDisplayMeta,
						loadTracks: () => AudioCheckApi.get('/apps/audiocheck/api/tracks', trackParams()),
						playAllTracks: async () => {
							const data = await AudioCheckApi.get('/apps/audiocheck/api/tracks', trackParams());
							const tracks = data.items || [];
							const totalTracks = data.total != null ? data.total : tracks.length;
							if (totalTracks > tracks.length) {
								AudioCheckMessaging.toast(
									t('audiocheck', 'Playing first {count} tracks.', { count: String(tracks.length) }),
									'info',
								);
							}
							return tracks;
						},
						mountBodyExtra: PA() && typeof PA().mountFolderListenedBar === 'function'
							? (bodyWrap, reload) => {
								PA().mountFolderListenedBar(bodyWrap, folderPath, config.kind, reload);
							}
							: undefined,
					});
				}

				function loadFolders() {
					panel.replaceChildren();
					moreWrap.textContent = '';
					status.textContent = t('audiocheck', 'Loading…');
					const host = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
					panel.appendChild(host);

					AudioCheckApi.get('/apps/audiocheck/api/facets/{type}', null, {
						params: { type: 'folders', kind: config.kind },
					}).then((data) => {
						const items = (data.items || []).slice();
						const q = query.toLowerCase();
						const filtered = q.length >= 2
							? items.filter((item) => displayFolderLabel(item.name).toLowerCase().includes(q)
								|| (item.name || '').toLowerCase().includes(q))
							: items;
						if (!filtered.length) {
							showEmpty(query.length >= 2
								? t('audiocheck', 'No matching folders.')
								: config.emptyFolders, 'folder', {
								label: t('audiocheck', 'Show all tracks'),
								onClick: () => loadTab('tracks'),
							});
							return;
						}
						const openAll = filtered.length === 1;
						filtered.forEach((item) => renderFolderGroup(item, host, openAll));
						const trackTotal = filtered.reduce((sum, item) => sum + (item.count || 0), 0);
						status.textContent = filtered.length === 1
							? t('audiocheck', '{folder} — {count} tracks', {
								folder: displayFolderLabel(filtered[0].name),
								count: String(trackTotal),
							})
							: t('audiocheck', '{folders} folders — {count} tracks', {
								folders: String(filtered.length),
								count: String(trackTotal),
							});
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				function loadAlbums(reset) {
					if (reset) {
						page = 1;
						panel.replaceChildren();
						panel.appendChild(C.el('div', { className: 'ac-grid ac-media-album-grid', id: idPrefix + '-album-grid' }));
					}
					const grid = panel.querySelector('#' + idPrefix + '-album-grid');
					if (!grid) return;
					status.textContent = t('audiocheck', 'Loading…');
					moreWrap.textContent = '';
					const params = { kind: config.kind, limit: PAGE_SIZE, page, sort };
					if (query.length >= 2) params.q = query;
					AudioCheckApi.get('/apps/audiocheck/api/collections', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							showEmpty(query.length >= 2
								? t('audiocheck', 'No matching collections.')
								: config.emptyAlbums, emptyIcon, {
								label: t('audiocheck', 'Show all tracks'),
								onClick: () => loadTab('tracks'),
							});
							return;
						}
						items.forEach((col) => {
							grid.appendChild(C.mediaCard({
								title: col.title,
								subtitle: col.subtitle,
								coverFileId: col.coverFileId,
								listened: !!col.fullyListened,
								finished: !!col.fullyListened,
							}, () => {
								if (PA()) PA().openCollectionDetail(col.key, col.title);
							}));
						});
						status.textContent = t('audiocheck', 'Showing {shown} of {total} collections', {
							shown: String(grid.children.length),
							total: String(total),
						});
						if (grid.children.length < total) {
							moreWrap.appendChild(C.el('button', {
								type: 'button',
								className: 'ac-btn ac-btn--primary',
								text: t('audiocheck', 'Load more'),
								onClick: () => { page += 1; loadAlbums(false); },
							}));
						}
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				function loadTab(type, reset) {
					setActiveTab(type);
					updateToolbar(type);
					if (reset) page = 1;
					if (type === 'tracks') loadTracks(!!reset);
					else if (type === 'folders') loadFolders();
					else loadAlbums(!!reset);
				}

				frag.appendChild(C.pageHeader(config.title, config.help, playAllBtn));

				const tabBar = C.el('div', {
					className: 'ac-browse-tabs ac-media-library-tabs',
					role: 'tablist',
					attrs: { 'aria-label': config.viewsAriaLabel },
				});
				panel = C.el('div', {
					id: idPrefix + '-panel',
					className: 'ac-media-library-panel ac-facet-browse-panel',
					attrs: {
						role: 'tabpanel',
						'aria-labelledby': idPrefix + '-tab-' + activeTab,
					},
				});
				leadEl = C.el('p', {
					className: 'ac-section__lead ac-media-library-lead ac-facet-browse-lead',
					text: config.tabLeads[activeTab] || '',
				});
				toolbar = C.el('div', { className: 'ac-toolbar ac-collection-toolbar ac-media-library-toolbar ac-facet-browse-toolbar' });
				status = C.el('p', {
					className: 'ac-field__hint ac-media-library-status ac-facet-browse-status',
					attrs: { role: 'status', 'aria-live': 'polite' },
				});
				moreWrap = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-collection-more ac-facet-browse-more' });

				tabButtons = config.tabs.map((tab) => {
					const btn = C.el('button', {
						type: 'button',
						className: 'ac-btn ac-browse-tab',
						text: tab.label,
						attrs: {
							role: 'tab',
							id: idPrefix + '-tab-' + tab.id,
							'aria-controls': idPrefix + '-panel',
							'aria-selected': tab.id === activeTab ? 'true' : 'false',
							tabindex: tab.id === activeTab ? '0' : '-1',
							'data-tab-id': tab.id,
						},
						onClick: () => {
							query = '';
							loadTab(tab.id, true);
						},
					});
					btn.addEventListener('keydown', (ev) => {
						if (ev.key === 'ArrowRight') { ev.preventDefault(); focusTabByOffset(1); }
						else if (ev.key === 'ArrowLeft') { ev.preventDefault(); focusTabByOffset(-1); }
						else if (ev.key === 'Home') { ev.preventDefault(); tabButtons[0].focus(); loadTab(tabButtons[0].dataset.tabId, true); }
						else if (ev.key === 'End') {
							ev.preventDefault();
							tabButtons[tabButtons.length - 1].focus();
							loadTab(tabButtons[tabButtons.length - 1].dataset.tabId, true);
						}
					});
					tabBar.appendChild(btn);
					return btn;
				});

				body.appendChild(tabBar);
				body.appendChild(leadEl);
				body.appendChild(toolbar);
				body.appendChild(status);
				body.appendChild(panel);
				body.appendChild(moreWrap);
				frag.appendChild(body);

				loadTab(activeTab, true);
				return frag;
			},
		});
	}

	window.AudioCheckMediaLibraryPage = { register: registerMediaLibraryPage };
})();
