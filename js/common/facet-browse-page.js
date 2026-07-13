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

	function facetTrackParams(type, item) {
		// Callers set their own page/limit; this only builds the filter params.
		const params = { sort: 'title' };
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

	function facetItemLabel(type, item) {
		if (type === 'favorites') {
			return t('audiocheck', 'Favorites');
		}
		if (type === 'tags') {
			return item.name || t('audiocheck', 'Tag');
		}
		if (type === 'folders') {
			return displayFolderLabel(item.name);
		}
		return item.name || t('audiocheck', 'Unknown');
	}

	function facetGroupLabel(type, item) {
		return facetItemLabel(type, item);
	}

	/**
	 * @param {object} config
	 * @param {string} config.viewId
	 * @param {string} config.title
	 * @param {string} config.help
	 * @param {string} config.viewsAriaLabel
	 * @param {Array<{id:string,labelKey:string}>} config.tabs
	 * @param {Record<string,string>} config.tabLeads
	 * @param {Record<string,{title:string,message:string,icon?:string,ctaLabel?:string}>} config.emptyCopy
	 * @param {string} [config.idPrefix]
	 */
	function searchQuery() {
		const g = GS();
		return g ? g.apiQueryParam(g.getDebouncedQuery()) : '';
	}

	function registerFacetBrowsePage(config) {
		const idPrefix = config.idPrefix || ('ac-' + config.viewId);

		AudioCheckRouter.register(config.viewId, {
			render() {
				const frag = document.createDocumentFragment();
				const body = C.el('div', { className: 'ac-page-body ac-media-library-page ac-facet-browse-page ac-library-browse-page' });

				let activeTab = config.tabs[0].id;
				let sort = 'title';
				let hideListened = false;
				let page = 1;
				let total = 0;
				let tabButtons = [];
				let panel = null;
				let toolbar = null;
				let status = null;
				let moreWrap = null;
				let playableCache = [];
				let playAllBtn = null;

				function updatePlayAllVisibility() {
					const show = activeTab === 'favorites';
					if (window.AudioCheckPageChrome) {
						if (show) AudioCheckPageChrome.setActions(playAllBtn);
						else AudioCheckPageChrome.clearActions();
					}
				}

				async function playAllFavorites() {
					if (!playAllBtn) return;
					playAllBtn.disabled = true;
					try {
						const baseParams = { favorite: '1', sort, limit: PLAY_ALL_PAGE_SIZE };
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

				playAllBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--primary',
					text: t('audiocheck', 'Play all'),
					attrs: { 'aria-label': t('audiocheck', 'Play all {kind}', { kind: t('audiocheck', 'Favorites') }) },
					onClick: () => playAllFavorites(),
				});

				function setActiveTab(type) {
					activeTab = type;
					tabButtons.forEach((btn) => {
						const on = btn.dataset.tabId === type;
						btn.setAttribute('aria-selected', on ? 'true' : 'false');
						btn.setAttribute('tabindex', on ? '0' : '-1');
					});
					if (panel) panel.setAttribute('aria-labelledby', idPrefix + '-tab-' + type);
					updatePlayAllVisibility();
				}

				function focusTabByOffset(offset) {
					const idx = tabButtons.findIndex((btn) => btn.dataset.tabId === activeTab);
					if (idx < 0) return;
					const next = tabButtons[(idx + offset + tabButtons.length) % tabButtons.length];
					next.focus();
					loadTab(next.dataset.tabId, true);
				}

				function updateToolbar(tabId) {
					if (!toolbar || !LPU()) return;
					toolbar.replaceChildren();
					const filtersRow = C.el('div', { className: 'ac-library-filters' });
					filtersRow.appendChild(LPU().buildSortChipRow({
						sort,
						options: LPU().defaultSortOptions(),
						groupLabel: t('audiocheck', 'Sort by'),
						compact: true,
						onChange: (nextSort) => {
							sort = nextSort;
							loadTab(tabId, true);
						},
					}));
					if (tabId === 'favorites') {
						filtersRow.appendChild(LPU().buildHideListenedFilter({
							idPrefix,
							checked: hideListened,
							compact: true,
							onChange: (next) => {
								hideListened = next;
								loadTab(tabId, true);
							},
						}));
					}
					toolbar.appendChild(filtersRow);
				}

				function emptyIconForTab(tabId) {
					const copy = config.emptyCopy[tabId];
					if (copy && copy.icon) return copy.icon;
					if (tabId === 'folders') return 'folder';
					if (tabId === 'favorites') return 'playlist';
					return 'app';
				}

				function showEmpty(tabId, message, extraCta) {
					panel.replaceChildren();
					moreWrap.textContent = '';
					status.textContent = '';
					const copy = config.emptyCopy[tabId] || {};
					panel.appendChild(C.emptyState(
						t('audiocheck', copy.title || 'Nothing here yet'),
						message || t('audiocheck', copy.message || 'Scan your library to find audio.'),
						{
							icon: emptyIconForTab(tabId),
							variant: 'section',
							ctaLabel: extraCta ? extraCta.label : (copy.ctaLabel ? t('audiocheck', copy.ctaLabel) : t('audiocheck', 'Open Library')),
							onCta: extraCta ? extraCta.onClick : () => AudioCheckRouter.navigate('library', {}, true),
						},
					));
				}

				function appendTracksToList(list, tracks, cache) {
					UIL().appendTracksToList(list, tracks, cache, C, trackDisplayMeta);
				}

				function renderFacetGroup(type, item, host, startOpen) {
					const label = facetGroupLabel(type, item);
					const count = item.count || 0;
					const trackParams = (pageNum, groupSort) => ({
						...facetTrackParams(type, item),
						sort: groupSort || sort,
						page: pageNum || 1,
						limit: PAGE_SIZE,
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
								batch.forEach((tr) => {
									if (tr && !tr.unavailable) tracks.push(tr);
								});
								if (batch.length === 0 || tracks.length >= totalTracks) break;
								pageNum += 1;
							}
							if (totalTracks > PLAY_ALL_MAX_TRACKS) {
								AudioCheckMessaging.toast(
									t('audiocheck', 'Playing first {count} tracks.', { count: String(tracks.length) }),
									'info',
								);
							}
							return tracks;
						},
						mountBodyExtra: type === 'folders' && PA() && typeof PA().mountFolderListenedBar === 'function'
							? (bodyWrap, reload) => {
								const trackParams = facetTrackParams(type, item);
								PA().mountFolderListenedBar(bodyWrap, item.name || '', trackParams.kind, reload);
							}
							: undefined,
					});
				}

				function loadFavorites(reset) {
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
					const params = { favorite: '1', limit: PAGE_SIZE, page, sort };
					const q = searchQuery();
					if (q) params.q = q;
					if (hideListened) params.hideListened = 1;
					AudioCheckApi.get('/apps/audiocheck/api/tracks', params).then((data) => {
						const items = data.items || [];
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length) {
							const favCopy = config.emptyCopy.favorites || {};
							showEmpty('favorites', q
								? noMatchMessage('favorites')
								: t('audiocheck', favCopy.message || 'Star tracks in Now playing or Browse.'));
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
								onClick: () => { page += 1; loadFavorites(false); },
							}));
						}
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				function loadFacets(type, reset) {
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

					const params = { type, page, limit: FACET_LIST_PAGE_SIZE };
					const q = searchQuery();
					if (q) {
						params.q = q;
					}

					AudioCheckApi.get('/apps/audiocheck/api/facets/{type}', null, { params }).then((data) => {
						let items = (data.items || []).slice();
						total = data.total != null ? data.total : items.length;
						if (reset && !items.length && page === 1) {
							const copy = config.emptyCopy[type] || {};
							showEmpty(type, q
								? noMatchMessage(type)
								: t('audiocheck', copy.message || 'Scan your library to find audio.'), type === 'artists' ? {
								label: t('audiocheck', 'Open Music'),
								onClick: () => AudioCheckRouter.navigate('music', {}, true),
							} : undefined);
							return;
						}
						const openAll = reset && page === 1 && items.length === 1 && total === 1;
						items.forEach((item) => renderFacetGroup(type, item, host, openAll));
						const shownGroups = host.children.length;
						const trackTotal = Array.from(host.children).reduce((sum, node) => {
							const countEl = node.querySelector('.ac-media-folder-group__count');
							const text = countEl ? countEl.textContent : '';
							const match = text && text.match(/(\d+)/);
							return sum + (match ? parseInt(match[1], 10) : 0);
						}, 0);
						if (shownGroups === 1 && host.children.length === 1) {
							status.textContent = t('audiocheck', '{folder} — {count} tracks', {
								folder: facetGroupLabel(type, items[0]),
								count: String(items[0].count || trackTotal),
							});
						} else {
							status.textContent = t('audiocheck', 'Showing {shown} of {total} items', {
								shown: String(shownGroups),
								total: String(total),
							});
						}
						if (shownGroups < total) {
							moreWrap.appendChild(C.el('button', {
								type: 'button',
								className: 'ac-btn ac-btn--primary',
								text: t('audiocheck', 'Load more'),
								onClick: () => { page += 1; loadFacets(type, false); },
							}));
						}
					}).catch((e) => {
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				function noMatchMessage(tabId) {
					if (tabId === 'folders') return t('audiocheck', 'No matching folders.');
					if (tabId === 'favorites') return t('audiocheck', 'No matching tracks.');
					return t('audiocheck', 'No matching items.');
				}

				function loadTab(type, reset) {
					setActiveTab(type);
					updateToolbar(type);
					if (reset) page = 1;
					if (type === 'favorites') {
						loadFavorites(!!reset);
					} else {
						loadFacets(type, !!reset);
					}
				}

				const tabBar = C.el('div', {
					className: 'ac-browse-tabs ac-media-library-tabs ac-facet-browse-tabs',
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
				toolbar = C.el('div', { className: 'ac-toolbar ac-collection-toolbar ac-media-library-toolbar ac-facet-browse-toolbar' });
				status = C.el('p', {
					className: 'ac-field__hint ac-media-library-status ac-facet-browse-status',
					attrs: { role: 'status', 'aria-live': 'polite' },
				});
				moreWrap = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-collection-more ac-facet-browse-more' });

				tabButtons = config.tabs.map((tab) => {
					const label = t('audiocheck', tab.labelKey);
					const btn = C.el('button', {
						type: 'button',
						className: 'ac-btn ac-browse-tab',
						text: label,
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

				const browseParts = LPU() ? LPU().createBrowseShell(config.viewsAriaLabel) : null;
				const shell = browseParts ? browseParts.shell : C.el('div', { className: 'ac-library-shell ac-library-shell--browse' });
				const controls = browseParts ? browseParts.controls : shell;
				const scroll = browseParts ? browseParts.scroll : shell;
				controls.appendChild(tabBar);
				controls.appendChild(toolbar);
				controls.appendChild(status);
				scroll.appendChild(panel);
				scroll.appendChild(moreWrap);
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

	window.AudioCheckFacetBrowsePage = { register: registerFacetBrowsePage };
})();
