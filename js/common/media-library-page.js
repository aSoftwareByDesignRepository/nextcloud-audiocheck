(function () {
	'use strict';

	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const UIL = () => (window.AudioCheckRequireTrackListUi
		? AudioCheckRequireTrackListUi()
		: window.AudioCheckTrackListUi);
	const GS = () => window.AudioCheckGlobalSearch;
	const LPU = () => window.AudioCheckLibraryPageUi;
	const PAGE_SIZE = 48;
	const FACET_LIST_PAGE_SIZE = 48;
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

	function searchQuery() {
		const g = GS();
		return g ? g.apiQueryParam(g.getDebouncedQuery()) : '';
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
				let hideListened = false;
				let page = 1;
				let total = 0;
				let tabButtons = [];
				let panel = null;
				let toolbar = null;
				let leadEl = null;
				let status = null;
				let moreWrap = null;
				let searchHintEl = null;
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
						const q = searchQuery();
						if (q) baseParams.q = q;
						if (hideListened) baseParams.hideListened = 1;
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
						if (window.AudioCheckPlaybackStart) {
							await AudioCheckPlaybackStart.playAllWithStartChoice(tracks);
						} else {
							AudioCheckPlayer.playQueue(tracks, 0);
							AudioCheckRouter.navigate('now-playing', {}, true);
						}
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
					if (window.AudioCheckPageChrome) {
						if (type === 'tracks') AudioCheckPageChrome.setActions(playAllBtn);
						else AudioCheckPageChrome.clearActions();
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
					if (!toolbar || !LPU()) return;
					toolbar.replaceChildren();
					const filtersRow = C.el('div', { className: 'ac-library-filters' });
					if (tabId !== 'folders') {
						filtersRow.appendChild(LPU().buildSortChipRow({
							sort,
							options: LPU().defaultSortOptions(sortArtistLabel),
							groupLabel: t('audiocheck', 'Sort by'),
							onChange: (nextSort) => {
								sort = nextSort;
								loadTab(tabId, true);
							},
						}));
					}
					if (tabId === 'tracks') {
						filtersRow.appendChild(LPU().buildHideListenedFilter({
							idPrefix,
							checked: hideListened,
							onChange: (next) => {
								hideListened = next;
								loadTab(tabId, true);
							},
						}));
					}
					if (filtersRow.children.length) {
						toolbar.appendChild(filtersRow);
						toolbar.hidden = false;
					} else {
						toolbar.hidden = true;
					}
				}

				function refreshSearchHint() {
					if (searchHintEl && typeof searchHintEl.refresh === 'function') {
						searchHintEl.refresh();
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
					const q = searchQuery();
					if (q) params.q = q;
					if (hideListened) params.hideListened = 1;
					AudioCheckApi.get('/apps/audiocheck/api/tracks', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							showEmpty(q
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
					const trackParams = (pageNum, groupSort) => ({
						folder: folderPath,
						kind: config.kind,
						limit: PAGE_SIZE,
						page: pageNum || 1,
						sort: groupSort || sort,
					});

					UIL().renderExpandableTrackGroup({
						C,
						label,
						count,
						host,
						startOpen,
						displayMeta: trackDisplayMeta,
						defaultSort: sort,
						inlineSort: true,
						inlinePlayActions: true,
						loadTracks: (pageNum, groupSort) => AudioCheckApi.get('/apps/audiocheck/api/tracks', trackParams(pageNum, groupSort)),
						playAllTracks: async (groupSort) => {
							const tracks = [];
							let pageNum = 1;
							let totalTracks = Infinity;
							const params = (p) => trackParams(p, groupSort);
							while (tracks.length < totalTracks && tracks.length < PLAY_ALL_MAX_TRACKS) {
								const data = await AudioCheckApi.get('/apps/audiocheck/api/tracks', params(pageNum));
								const batch = data.items || [];
								totalTracks = data.total != null ? data.total : batch.length;
								tracks.push(...batch);
								if (batch.length === 0 || tracks.length >= totalTracks) break;
								pageNum += 1;
							}
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

				function loadFolders(reset) {
					if (reset) {
						page = 1;
						panel.replaceChildren();
						moreWrap.textContent = '';
						const host = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
						panel.appendChild(host);
					}
					const host = panel.querySelector('.ac-facet-groups');
					if (!host) return;
					status.textContent = t('audiocheck', 'Loading…');

					AudioCheckApi.get('/apps/audiocheck/api/facets/{type}', null, {
						params: { type: 'folders', kind: config.kind, page, limit: FACET_LIST_PAGE_SIZE },
					}).then((data) => {
						const items = (data.items || []).slice();
						const facetTotal = data.total != null ? data.total : items.length;
						const q = searchQuery();
						const filtered = q
							? items.filter((item) => GS().matchesSearchQuery([
								displayFolderLabel(item.name),
								item.name,
							], q))
							: items;
						if (reset && page === 1 && !filtered.length) {
							showEmpty(q
								? t('audiocheck', 'No matching folders.')
								: config.emptyFolders, 'folder', {
								label: t('audiocheck', 'Show all tracks'),
								onClick: () => loadTab('tracks'),
							});
							return;
						}
						const openAll = reset && page === 1 && filtered.length === 1 && facetTotal === 1;
						filtered.forEach((item) => renderFolderGroup(item, host, openAll));
						const shown = host.children.length;
						status.textContent = t('audiocheck', 'Showing {shown} of {total} folders', {
							shown: String(shown),
							total: String(facetTotal),
						});
						if (shown < facetTotal) {
							moreWrap.appendChild(C.el('button', {
								type: 'button',
								className: 'ac-btn ac-btn--primary',
								text: t('audiocheck', 'Load more'),
								onClick: () => { page += 1; loadFolders(false); },
							}));
						}
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
					const q = searchQuery();
					if (q) params.q = q;
					AudioCheckApi.get('/apps/audiocheck/api/collections', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							showEmpty(q
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
					refreshSearchHint();
					if (reset) page = 1;
					if (type === 'tracks') loadTracks(!!reset);
					else if (type === 'folders') loadFolders(!!reset);
					else loadAlbums(!!reset);
				}

				if (window.AudioCheckPageChrome && activeTab === 'tracks') {
					AudioCheckPageChrome.setActions(playAllBtn);
				}

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
						onClick: () => loadTab(tab.id, true),
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

				const shell = LPU() ? LPU().createContentShell() : C.el('div', { className: 'ac-library-shell' });
				searchHintEl = LPU() ? LPU().buildSearchHint(searchQuery) : null;
				shell.appendChild(leadEl);
				if (searchHintEl) shell.appendChild(searchHintEl);
				shell.appendChild(toolbar);
				shell.appendChild(status);
				shell.appendChild(panel);
				shell.appendChild(moreWrap);
				body.appendChild(tabBar);
				body.appendChild(shell);
				frag.appendChild(body);

				loadTab(activeTab, true);
				if (GS()) {
					GS().registerViewHandler(config.viewId, () => loadTab(activeTab, true));
				}
				return frag;
			},
		});
	}

	window.AudioCheckMediaLibraryPage = { register: registerMediaLibraryPage };
})();
