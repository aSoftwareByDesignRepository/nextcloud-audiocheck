(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const UIL = () => (window.AudioCheckRequireTrackListUi
		? AudioCheckRequireTrackListUi()
		: window.AudioCheckTrackListUi);
	const GS = () => window.AudioCheckGlobalSearch;
	const LPU = () => window.AudioCheckLibraryPageUi;
	const FAVORITES_ID = AudioCheckConstants.FAVORITES_PLAYLIST_ID;
	const isFavorites = (id) => AudioCheckConstants.isFavoritesPlaylist(id);
	const PAGE_SIZE = 48;
	const PLAY_ALL_PAGE_SIZE = 100;
	const PLAY_ALL_MAX_TRACKS = 500;

	function searchQuery() {
		const g = GS();
		return g ? g.apiQueryParam(g.getDebouncedQuery()) : '';
	}

	function sortTracksForGroup(items, groupSort) {
		const s = groupSort || 'title';
		return (items || []).slice().sort((a, b) => {
			if (s === 'artist') return String(a.artist || '').localeCompare(String(b.artist || ''));
			if (s === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
			return String(a.title || a.fileName || '').localeCompare(String(b.title || b.fileName || ''));
		});
	}

	function playlistMatchesSearch(pl, q) {
		if (!q) return true;
		const g = GS();
		return g ? g.matchesSearchQuery([pl.name], q) : true;
	}

	function summaryActionBtn(label, onClick) {
		return C.el('button', {
			type: 'button',
			className: 'ac-btn ac-btn--compact ac-playlist-group__action',
			text: label,
			onClick: (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				onClick();
			},
		});
	}

	function createPlaylistModal(onCreated) {
		C.openModal({
			title: t('audiocheck', 'New playlist'),
			primaryLabel: t('audiocheck', 'Create'),
			render() {
				const input = C.createElement('input', {
					type: 'text',
					className: 'ac-input',
					attrs: {
						id: 'ac-new-playlist-name',
						maxlength: '255',
						'aria-label': t('audiocheck', 'Playlist name'),
						required: true,
					},
				});
				const wrap = C.createElement('div', { class: 'ac-form-row' }, [
					C.createElement('label', { attrs: { for: 'ac-new-playlist-name' }, text: t('audiocheck', 'Playlist name') }),
					input,
				]);
				setTimeout(() => input.focus(), 50);
				return wrap;
			},
			onSubmit: async ({ body }) => {
				const input = body.querySelector('#ac-new-playlist-name');
				const name = input ? input.value.trim() : '';
				if (!name) {
					AudioCheckMessaging.toast(t('audiocheck', 'Enter a playlist name.'), 'warning');
					input?.focus();
					return false;
				}
				await AudioCheckApi.post('/apps/audiocheck/api/playlists', { name });
				onCreated();
				return true;
			},
		});
	}

	function renamePlaylistModal(playlistId, currentName, onDone) {
		C.openModal({
			title: t('audiocheck', 'Rename playlist'),
			primaryLabel: t('audiocheck', 'Save'),
			render() {
				const input = C.createElement('input', {
					type: 'text',
					className: 'ac-input',
					attrs: {
						id: 'ac-rename-playlist',
						maxlength: '255',
						value: currentName,
						'aria-label': t('audiocheck', 'Playlist name'),
					},
				});
				setTimeout(() => { input.focus(); input.select(); }, 50);
				return C.createElement('div', { class: 'ac-form-row' }, [
					C.createElement('label', { attrs: { for: 'ac-rename-playlist' }, text: t('audiocheck', 'Playlist name') }),
					input,
				]);
			},
			onSubmit: async ({ body }) => {
				const input = body.querySelector('#ac-rename-playlist');
				const name = input ? input.value.trim() : '';
				if (!name) {
					AudioCheckMessaging.toast(t('audiocheck', 'Enter a playlist name.'), 'warning');
					return false;
				}
				await AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}', { name }, { params: { id: playlistId } });
				AudioCheckMessaging.toast(t('audiocheck', 'Saved.'));
				onDone();
				return true;
			},
		});
	}

	function addTracksModal(playlistId, onAdded) {
		let timer = null;
		let seq = 0;

		C.openModal({
			title: t('audiocheck', 'Add tracks'),
			primaryLabel: t('audiocheck', 'Done'),
			cancelLabel: t('audiocheck', 'Close'),
			render() {
				const search = C.createElement('input', {
					type: 'search',
					className: 'ac-input',
					attrs: {
						id: 'ac-add-tracks-search',
						'aria-label': t('audiocheck', 'Search tracks…'),
						placeholder: t('audiocheck', 'Search tracks…'),
						autocomplete: 'off',
					},
				});
				const status = C.createElement('p', {
					class: 'ac-field__hint',
					attrs: { role: 'status', 'aria-live': 'polite' },
					text: t('audiocheck', 'Type at least two characters to search.'),
				});
				const ul = C.createElement('ul', { className: 'ac-track-list ac-track-list--compact' });

				function runSearch(q) {
					const mySeq = ++seq;
					if (q.length < 2) {
						ul.textContent = '';
						status.textContent = t('audiocheck', 'Type at least two characters to search.');
						return;
					}
					status.textContent = t('audiocheck', 'Loading…');
					AudioCheckApi.get('/apps/audiocheck/api/tracks', { q, limit: 30 }).then((data) => {
						if (mySeq !== seq) return;
						ul.textContent = '';
						const items = data.items || [];
						if (!items.length) {
							status.textContent = t('audiocheck', 'No matching tracks.');
							return;
						}
						status.textContent = AudioCheckTime.tracksLabel(items.length);
						items.forEach((track) => {
							const li = C.trackRow(track, null, {
								hidePlay: true,
								onAddPlaylist: async () => {
									try {
										await AudioCheckApi.post('/apps/audiocheck/api/playlists/{id}/items', { fileId: track.fileId }, { params: { id: playlistId } });
										AudioCheckMessaging.toast(t('audiocheck', 'Added to playlist.'));
										onAdded();
									} catch (e) {
										AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
									}
								},
							});
							ul.appendChild(li);
						});
					}).catch((e) => {
						if (mySeq !== seq) return;
						status.textContent = e.message || t('audiocheck', 'Request failed.');
					});
				}

				search.addEventListener('input', () => {
					clearTimeout(timer);
					timer = setTimeout(() => runSearch(search.value.trim()), 300);
				});
				setTimeout(() => search.focus(), 50);

				return C.createElement('div', { class: 'ac-add-tracks' }, [search, status, ul]);
			},
			onSubmit: () => true,
		});
	}

	function fetchFavoriteCount() {
		return AudioCheckApi.get('/apps/audiocheck/api/tracks', { favorite: '1', limit: 1 })
			.then((data) => (typeof data.total === 'number' ? data.total : (data.items || []).length));
	}

	function playlistRowOptionsForUserPlaylist(track, playlistId, items, reload) {
		const index = items.findIndex((it) => it.id === track.id);
		return UIL().trackRowOptions(track, {
			onRemove: () => {
				AudioCheckApi.del('/apps/audiocheck/api/playlist-items/{id}', null, { params: { id: track.id } })
					.then(() => reload())
					.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
			},
			removeLabel: t('audiocheck', 'Remove from playlist'),
			onMoveUp: index > 0 ? () => reorderPlaylistItems(playlistId, items, index, -1, reload) : null,
			onMoveDown: index >= 0 && index < items.length - 1
				? () => reorderPlaylistItems(playlistId, items, index, 1, reload)
				: null,
			moveUpDisabled: index <= 0,
			moveDownDisabled: index < 0 || index >= items.length - 1,
		});
	}

	function reorderPlaylistItems(playlistId, items, index, delta, reload) {
		const target = index + delta;
		if (target < 0 || target >= items.length) return;
		const ids = items.map((it) => it.id);
		const tmp = ids[index];
		ids[index] = ids[target];
		ids[target] = tmp;
		AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}/items/reorder', { itemIds: ids }, { params: { id: playlistId } })
			.then(() => reload())
			.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
	}

	function mountPlaylistSummaryActions(summary, pl, reload) {
		const actions = C.el('div', { className: 'ac-playlist-group__actions' });
		actions.appendChild(summaryActionBtn(
			t('audiocheck', 'Add tracks'),
			() => addTracksModal(pl.id, reload),
		));
		actions.appendChild(summaryActionBtn(
			pl.isPinned ? t('audiocheck', 'Unpin') : t('audiocheck', 'Pin'),
			() => {
				AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}', { isPinned: !pl.isPinned }, { params: { id: pl.id } })
					.then(() => reload())
					.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
			},
		));
		actions.appendChild(summaryActionBtn(
			t('audiocheck', 'Rename'),
			() => renamePlaylistModal(pl.id, pl.name, reload),
		));
		actions.appendChild(summaryActionBtn(
			t('audiocheck', 'Delete'),
			() => {
				C.confirmDialog({
					title: t('audiocheck', 'Delete playlist?'),
					message: t('audiocheck', 'This cannot be undone.'),
					confirmLabel: t('audiocheck', 'Delete playlist'),
					onConfirm: async () => {
						await AudioCheckApi.del('/apps/audiocheck/api/playlists/{id}', null, { params: { id: pl.id } });
						AudioCheckMessaging.toast(t('audiocheck', 'Playlist deleted.'));
						reload();
					},
				});
			},
		));
		summary.appendChild(actions);
	}

	function renderFavoritesGroup(host, count, startOpen, reloadPage) {
		const label = t('audiocheck', 'Favorites');
		const group = UIL().renderExpandableTrackGroup({
			C,
			label,
			count,
			host,
			startOpen,
			groupClassName: 'ac-playlist-group ac-playlist-group--favorites',
			defaultSort: 'title',
			inlineSort: true,
			inlinePlayActions: true,
			loadTracks: (pageNum, groupSort) => AudioCheckApi.get('/apps/audiocheck/api/tracks', {
				favorite: '1',
				limit: PAGE_SIZE,
				page: pageNum || 1,
				sort: groupSort || 'title',
			}),
			playAllTracks: async (groupSort) => {
				const tracks = [];
				let pageNum = 1;
				let totalTracks = Infinity;
				while (tracks.length < totalTracks && tracks.length < PLAY_ALL_MAX_TRACKS) {
					const data = await AudioCheckApi.get('/apps/audiocheck/api/tracks', {
						favorite: '1',
						sort: groupSort || 'title',
						limit: PLAY_ALL_PAGE_SIZE,
						page: pageNum,
					});
					const batch = data.items || [];
					batch.forEach((tr) => {
						if (tr && !tr.unavailable) tracks.push(tr);
					});
					totalTracks = data.total != null ? data.total : tracks.length;
					if (batch.length < PLAY_ALL_PAGE_SIZE) break;
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
			rowOptionsForTrack: (track) => UIL().trackRowOptions(track, {
				onRemove: () => {
					AudioCheckApi.put('/apps/audiocheck/api/tracks/{fileId}/favorite', { favorite: false }, { params: { fileId: track.fileId } })
						.then(() => {
							group.reload();
							reloadPage();
						})
						.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
				},
				removeLabel: t('audiocheck', 'Remove from favorites'),
			}),
		});
		return group;
	}

	function renderUserPlaylistGroup(host, pl, startOpen, reloadPage) {
		const label = pl.name || t('audiocheck', 'Playlist');
		const count = pl.trackCount != null ? pl.trackCount : 0;
		let currentItems = [];

		const group = UIL().renderExpandableTrackGroup({
			C,
			label,
			count,
			host,
			startOpen,
			groupClassName: 'ac-playlist-group' + (pl.isPinned ? ' ac-playlist-group--pinned' : ''),
			mountSummaryExtra: (summary) => mountPlaylistSummaryActions(summary, pl, reloadPage),
			defaultSort: 'title',
			inlineSort: true,
			inlinePlayActions: true,
			loadTracks: async (pageNum, groupSort) => {
				const data = await AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: pl.id } });
				const playlist = data.playlist || {};
				currentItems = playlist.items || [];
				const sorted = sortTracksForGroup(currentItems, groupSort);
				const page = pageNum || 1;
				const start = (page - 1) * PAGE_SIZE;
				return {
					items: sorted.slice(start, start + PAGE_SIZE),
					total: sorted.length,
				};
			},
			playAllTracks: async () => {
				const data = await AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: pl.id } });
				return (data.playlist?.items || []);
			},
			rowOptionsForTrack: (track) => playlistRowOptionsForUserPlaylist(track, pl.id, currentItems, () => {
				group.reload();
				reloadPage();
			}),
		});
		return group;
	}

	function renderPlaylistsIndex(body, playlists, favCount, searchQ) {
		body.textContent = '';
		const q = searchQ || '';
		const filtered = playlists.filter((pl) => playlistMatchesSearch(pl, q));
		const pinned = filtered.filter((pl) => pl.isPinned);
		const other = filtered.filter((pl) => !pl.isPinned);
		const hasPinnedInLibrary = playlists.some((pl) => pl.isPinned);
		const userSectionTitle = hasPinnedInLibrary
			? t('audiocheck', 'All playlists')
			: t('audiocheck', 'Your playlists');

		const shell = LPU() ? LPU().createContentShell() : C.el('div', { className: 'ac-library-shell' });
		const searchHint = LPU() ? LPU().buildSearchHint(searchQuery) : null;
		const lead = C.el('p', {
			className: 'ac-section__lead ac-facet-browse-lead',
			text: t('audiocheck', 'Open a playlist to see its tracks. Use Play on a row or Play all on a group header.'),
		});
		const status = C.el('p', {
			className: 'ac-field__hint ac-facet-browse-status',
			attrs: { role: 'status', 'aria-live': 'polite' },
		});
		const panel = C.el('div', { className: 'ac-media-library-panel ac-facet-browse-panel' });
		const sectionsWrap = C.el('div', { className: 'ac-library-sections' });
		panel.appendChild(sectionsWrap);
		shell.appendChild(lead);
		if (searchHint) shell.appendChild(searchHint);
		shell.appendChild(status);
		shell.appendChild(panel);
		body.appendChild(shell);

		function reloadPage() {
			Promise.all([
				AudioCheckApi.get('/apps/audiocheck/api/playlists'),
				fetchFavoriteCount().catch(() => 0),
			]).then(([data, newFavCount]) => {
				renderPlaylistsIndex(body, data.playlists || [], newFavCount, searchQuery());
			}).catch((e) => {
				status.textContent = e.message || t('audiocheck', 'Request failed.');
			});
		}

		if (q && !pinned.length && !other.length && !favCount) {
			panel.replaceChildren();
			panel.appendChild(C.emptyState(
				t('audiocheck', 'No matching playlists'),
				t('audiocheck', 'Try a different search term.'),
				{ icon: 'playlist', variant: 'section' },
			));
			status.textContent = '';
			return;
		}

		const favSection = C.el('section', {
			className: 'ac-library-page-section',
			attrs: { 'aria-labelledby': 'ac-playlists-favorites-heading' },
		});
		favSection.appendChild(LPU()
			? LPU().sectionHeading(t('audiocheck', 'Favorites'), 'ac-playlists-favorites-heading')
			: C.el('h2', { id: 'ac-playlists-favorites-heading', text: t('audiocheck', 'Favorites') }));
		const favHost = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
		favSection.appendChild(favHost);
		sectionsWrap.appendChild(favSection);
		const openFavorites = pinned.length + other.length === 0;
		renderFavoritesGroup(favHost, favCount, openFavorites, reloadPage);

		if (pinned.length) {
			const pinSection = C.el('section', {
				className: 'ac-library-page-section',
				attrs: { 'aria-labelledby': 'ac-playlists-pinned-heading' },
			});
			pinSection.appendChild(LPU()
				? LPU().sectionHeading(t('audiocheck', 'Pinned'), 'ac-playlists-pinned-heading')
				: C.el('h2', { id: 'ac-playlists-pinned-heading', text: t('audiocheck', 'Pinned') }));
			const pinHost = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
			pinSection.appendChild(pinHost);
			sectionsWrap.appendChild(pinSection);
			const openFirstPinned = pinned.length === 1 && !other.length;
			pinned.forEach((pl, idx) => {
				renderUserPlaylistGroup(pinHost, pl, openFirstPinned && idx === 0, reloadPage);
			});
		}

		const userSection = C.el('section', {
			className: 'ac-library-page-section',
			attrs: { 'aria-labelledby': 'ac-playlists-user-heading' },
		});
		userSection.appendChild(LPU()
			? LPU().sectionHeading(userSectionTitle, 'ac-playlists-user-heading')
			: C.el('h2', { id: 'ac-playlists-user-heading', text: userSectionTitle }));
		const userHost = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
		userSection.appendChild(userHost);
		sectionsWrap.appendChild(userSection);

		if (!other.length) {
			if (q) {
				userHost.appendChild(C.emptyState(
					t('audiocheck', 'No matching playlists'),
					t('audiocheck', 'Try a different search term.'),
					{ icon: 'playlist', variant: 'section' },
				));
			} else if (!playlists.length) {
				userHost.appendChild(C.emptyState(
					t('audiocheck', 'No playlists yet'),
					t('audiocheck', 'Create a playlist to group your favorite tracks.'),
					{
						icon: 'playlist',
						variant: 'section',
						ctaLabel: t('audiocheck', 'New playlist'),
						onCta: () => createPlaylistModal(reloadPage),
					},
				));
			}
		} else {
			const openFirst = other.length === 1 && !pinned.length;
			other.forEach((pl, idx) => {
				renderUserPlaylistGroup(userHost, pl, openFirst && idx === 0, reloadPage);
			});
		}

		const visiblePlaylists = pinned.length + other.length;
		const trackTotal = other.reduce((sum, pl) => sum + (pl.trackCount || 0), 0)
			+ pinned.reduce((sum, pl) => sum + (pl.trackCount || 0), 0)
			+ (favCount || 0);
		if (q && visiblePlaylists === 0 && favCount > 0) {
			status.textContent = t('audiocheck', 'No matching playlists');
		} else if (visiblePlaylists > 0 || favCount > 0) {
			const listCount = visiblePlaylists + 1;
			const listLabel = listCount === 1
				? t('audiocheck', '1 item')
				: t('audiocheck', '{count} items', { count: String(listCount) });
			status.textContent = listLabel + ' — ' + AudioCheckTime.tracksLabel(trackTotal);
		} else {
			status.textContent = '';
		}
	}

	function renderPlaylistDetail(frag, playlistId) {
		const isFav = isFavorites(playlistId);
		let sort = 'title';
		let query = '';
		let page = 1;
		let total = 0;
		let timer = null;
		let playableCache = [];
		let playlistData = null;

		const favTitle = t('audiocheck', 'Favorites');
		const favHelp = t('audiocheck', 'Tracks you starred in Now playing or Browse. They also sync with the Files app.');
		if (window.AudioCheckPageChrome) {
			AudioCheckPageChrome.update('playlist', {
				title: isFav ? favTitle : t('audiocheck', 'Playlist'),
				help: isFav ? favHelp : t('audiocheck', 'View and play playlist tracks.'),
				icon: 'playlist',
			});
		}

		const body = C.el('div', { className: 'ac-page-body ac-playlists-page ac-facet-browse-page' });
		const shell = LPU() ? LPU().createContentShell() : C.el('div', { className: 'ac-library-shell' });
		const toolbar = C.el('div', { className: 'ac-toolbar ac-collection-toolbar ac-facet-browse-toolbar' });
		const status = C.el('p', {
			className: 'ac-field__hint ac-facet-browse-status',
			attrs: { role: 'status', 'aria-live': 'polite' },
		});
		const panel = C.el('div', { className: 'ac-media-library-panel ac-facet-browse-panel' });
		const moreWrap = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-facet-browse-more' });
		shell.appendChild(toolbar);
		shell.appendChild(status);
		shell.appendChild(panel);
		shell.appendChild(moreWrap);
		body.appendChild(shell);
		frag.appendChild(body);

		function updateToolbar() {
			toolbar.replaceChildren();
			const filtersRow = C.el('div', { className: 'ac-library-filters ac-library-filters--detail' });
			const searchGroup = C.el('div', { className: 'ac-library-filters__group ac-library-filters__group--search' });
			searchGroup.appendChild(C.el('label', {
				className: 'ac-library-filters__label',
				text: t('audiocheck', 'Search tracks'),
				attrs: { for: 'ac-playlist-detail-search' },
			}));
			const search = C.el('input', {
				type: 'search',
				className: 'ac-input ac-collection-toolbar__search',
				attrs: {
					id: 'ac-playlist-detail-search',
					'aria-label': t('audiocheck', 'Search tracks…'),
					placeholder: t('audiocheck', 'Search tracks…'),
					autocomplete: 'off',
					value: query,
				},
			});
			search.addEventListener('input', () => {
				clearTimeout(timer);
				query = search.value.trim();
				timer = setTimeout(() => loadTracks(true), 300);
			});
			searchGroup.appendChild(search);
			filtersRow.appendChild(searchGroup);
			if (LPU()) {
				filtersRow.appendChild(LPU().buildSortChipRow({
					sort,
					options: LPU().defaultSortOptions(),
					groupLabel: t('audiocheck', 'Sort by'),
					onChange: (nextSort) => {
						sort = nextSort;
						loadTracks(true);
					},
				}));
			}
			toolbar.appendChild(filtersRow);
		}

		function renderHeaderActions() {
			const playable = isFav
				? playableCache
				: (playlistData?.items || []).filter((x) => !x.unavailable);
			const playLabel = playable.length === 1 ? t('audiocheck', 'Play') : t('audiocheck', 'Play all');
			const playAll = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: playLabel,
				disabled: playable.length === 0,
				onClick: () => {
					if (window.AudioCheckPlaybackStart && playable.length > 1) {
						AudioCheckPlaybackStart.playAllWithStartChoice(playable);
					} else {
						AudioCheckPlayer.playQueue(playable, 0);
						AudioCheckRouter.navigate('now-playing', {}, true);
					}
				},
			});
			const back = C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Back to playlists'),
				onClick: () => AudioCheckRouter.navigate('playlists', {}, true),
			});
			const secondary = [back];
			if (!isFav && playlistData) {
				const pl = playlistData;
				secondary.unshift(
					C.el('button', {
						type: 'button',
						className: 'ac-btn ac-btn--danger',
						text: t('audiocheck', 'Delete playlist'),
						onClick: () => {
							C.confirmDialog({
								title: t('audiocheck', 'Delete playlist?'),
								message: t('audiocheck', 'This cannot be undone.'),
								confirmLabel: t('audiocheck', 'Delete playlist'),
								onConfirm: async () => {
									await AudioCheckApi.del('/apps/audiocheck/api/playlists/{id}', null, { params: { id: playlistId } });
									AudioCheckMessaging.toast(t('audiocheck', 'Playlist deleted.'));
									AudioCheckRouter.navigate('playlists', {}, true);
								},
							});
						},
					}),
					C.el('button', {
						type: 'button',
						className: 'ac-btn',
						text: t('audiocheck', 'Rename'),
						onClick: () => renamePlaylistModal(playlistId, pl.name, () => load()),
					}),
					C.el('button', {
						type: 'button',
						className: 'ac-btn',
						text: pl.isPinned ? t('audiocheck', 'Unpin playlist') : t('audiocheck', 'Pin playlist'),
						onClick: () => {
							AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}', { isPinned: !pl.isPinned }, { params: { id: playlistId } })
								.then(() => load())
								.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
						},
					}),
					C.el('button', {
						type: 'button',
						className: 'ac-btn',
						text: t('audiocheck', 'Add tracks'),
						onClick: () => addTracksModal(playlistId, () => load()),
					}),
				);
			}
			if (window.AudioCheckPageChrome) {
				AudioCheckPageChrome.setActionsGrouped([playAll], secondary);
			}
		}

		function loadFavorites(reset) {
			if (reset) {
				page = 1;
				playableCache = [];
				panel.replaceChildren();
				panel.appendChild(C.el('ul', { className: 'ac-track-list', id: 'ac-playlist-detail-list' }));
			}
			const list = panel.querySelector('#ac-playlist-detail-list');
			if (!list) return;
			status.textContent = t('audiocheck', 'Loading…');
			moreWrap.textContent = '';
			const params = { favorite: '1', limit: PAGE_SIZE, page, sort };
			if (query.length >= 2) params.q = query;
			AudioCheckApi.get('/apps/audiocheck/api/tracks', params).then((data) => {
				const items = data.items || [];
				total = data.total != null ? data.total : items.length;
				if (reset && !items.length) {
					panel.replaceChildren();
					panel.appendChild(C.emptyState(
						t('audiocheck', 'No favorite tracks yet'),
						query.length >= 2
							? t('audiocheck', 'No matching tracks.')
							: t('audiocheck', 'Star tracks in Now playing or Browse. Favorites also appear in the Files app.'),
						{ icon: 'playlist' },
					));
					status.textContent = '';
					renderHeaderActions();
					return;
				}
				UIL().appendTracksToList(list, items, playableCache, C, null, (track) => UIL().trackRowOptions(track, {
					onRemove: () => {
						AudioCheckApi.put('/apps/audiocheck/api/tracks/{fileId}/favorite', { favorite: false }, { params: { fileId: track.fileId } })
							.then(() => load())
							.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
					},
					removeLabel: t('audiocheck', 'Remove from favorites'),
				}));
				status.textContent = t('audiocheck', 'Showing {shown} of {total} tracks', {
					shown: String(list.children.length),
					total: String(total),
				});
				renderHeaderActions();
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

		function loadUserPlaylist() {
			status.textContent = t('audiocheck', 'Loading…');
			moreWrap.textContent = '';
			AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: playlistId } })
				.then((data) => {
					playlistData = data.playlist || {};
					if (window.AudioCheckPageChrome) {
						AudioCheckPageChrome.update('playlist', {
							title: playlistData.name || t('audiocheck', 'Playlist'),
							help: t('audiocheck', 'View and play playlist tracks.'),
							icon: 'playlist',
						});
					}
					renderHeaderActions();

					let items = playlistData.items || [];
					if (query.length >= 2) {
						const q = query.toLowerCase();
						items = items.filter((tr) => {
							const title = (tr.title || tr.fileName || '').toLowerCase();
							const artist = (tr.artist || '').toLowerCase();
							return title.includes(q) || artist.includes(q);
						});
					}
					if (sort !== 'title') {
						items = items.slice().sort((a, b) => {
							if (sort === 'artist') return String(a.artist || '').localeCompare(String(b.artist || ''));
							if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
							if (sort === 'played') return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
							return String(a.title || a.fileName || '').localeCompare(String(b.title || b.fileName || ''));
						});
					}

					panel.replaceChildren();
					const list = C.el('ul', { className: 'ac-track-list' });
					panel.appendChild(list);
					if (!items.length) {
						panel.replaceChildren();
						panel.appendChild(C.emptyState(
							t('audiocheck', 'This playlist is empty.'),
							query.length >= 2
								? t('audiocheck', 'No matching tracks.')
								: t('audiocheck', 'Add tracks with the button above.'),
							{ icon: 'playlist' },
						));
						status.textContent = '';
						return;
					}

					const cache = [];
					const allItems = playlistData.items || [];
					UIL().appendTracksToList(list, items, cache, C, null, (track) => (
						playlistRowOptionsForUserPlaylist(track, playlistId, allItems, () => load())
					));
					status.textContent = AudioCheckTime.tracksLabel(items.length);
				})
				.catch((e) => {
					status.textContent = e.message || t('audiocheck', 'Request failed.');
				});
		}

		function loadTracks(reset) {
			if (isFav) loadFavorites(!!reset);
			else loadUserPlaylist();
		}

		function load() {
			updateToolbar();
			loadTracks(true);
		}

		load();
	}

	AudioCheckRouter.register('playlists', {
		render() {
			const frag = document.createDocumentFragment();
			const reload = () => AudioCheckRouter.navigate('playlists', {}, false);
			const createBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'New playlist'),
				onClick: () => createPlaylistModal(reload),
			});
			if (window.AudioCheckPageChrome) AudioCheckPageChrome.setActions(createBtn);

			const body = C.el('div', { className: 'ac-page-body ac-playlists-page ac-facet-browse-page' });
			body.appendChild(C.el('div', {
				className: 'ac-playlists-loading',
				attrs: { role: 'status', 'aria-live': 'polite' },
			}, [
				C.el('span', { className: 'ac-skeleton ac-skeleton--title' }),
				C.el('span', { className: 'ac-skeleton ac-skeleton--card' }),
			]));
			frag.appendChild(body);

			function loadIndex() {
				Promise.all([
					AudioCheckApi.get('/apps/audiocheck/api/playlists'),
					fetchFavoriteCount().catch(() => 0),
				]).then(([data, favCount]) => {
					renderPlaylistsIndex(body, data.playlists || [], favCount, searchQuery());
				}).catch((e) => {
					body.textContent = '';
					body.appendChild(C.emptyState(
						t('audiocheck', 'Could not load playlists'),
						e.message || t('audiocheck', 'Request failed.'),
						{ icon: 'playlist' },
					));
				});
			}

			loadIndex();
			if (GS()) {
				GS().registerViewHandler('playlists', loadIndex);
			}

			return frag;
		},
	});

	AudioCheckRouter.register('playlist', {
		render(params) {
			const frag = document.createDocumentFragment();
			renderPlaylistDetail(frag, params.playlistId);
			return frag;
		},
	});
})();
