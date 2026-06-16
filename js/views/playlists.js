(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const UIL = () => window.AudioCheckTrackListUi;
	const FAVORITES_ID = AudioCheckConstants.FAVORITES_PLAYLIST_ID;
	const isFavorites = (id) => AudioCheckConstants.isFavoritesPlaylist(id);
	const PAGE_SIZE = 48;
	const PLAY_ALL_PAGE_SIZE = 100;
	const PLAY_ALL_MAX_TRACKS = 500;

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
			loadTracks: () => AudioCheckApi.get('/apps/audiocheck/api/tracks', {
				favorite: '1',
				limit: UIL().FACET_TRACK_LIMIT,
				sort: 'title',
			}),
			playAllTracks: async () => {
				const tracks = [];
				let pageNum = 1;
				let totalTracks = Infinity;
				while (tracks.length < totalTracks && tracks.length < PLAY_ALL_MAX_TRACKS) {
					const data = await AudioCheckApi.get('/apps/audiocheck/api/tracks', {
						favorite: '1',
						sort: 'title',
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
				if (totalTracks > tracks.length) {
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
			loadTracks: async () => {
				const data = await AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: pl.id } });
				const playlist = data.playlist || {};
				currentItems = playlist.items || [];
				return { items: currentItems, total: currentItems.length };
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

	function renderPlaylistsIndex(body, playlists, favCount) {
		body.textContent = '';
		const lead = C.el('p', {
			className: 'ac-section__lead ac-facet-browse-lead',
			text: t('audiocheck', 'Open a playlist to see its tracks. Use Play on a row or Play all on a group header.'),
		});
		const status = C.el('p', {
			className: 'ac-field__hint ac-facet-browse-status',
			attrs: { role: 'status', 'aria-live': 'polite' },
		});
		const panel = C.el('div', { className: 'ac-media-library-panel ac-facet-browse-panel' });
		const host = C.el('div', { className: 'ac-media-folder-groups ac-facet-groups' });
		panel.appendChild(host);
		body.appendChild(lead);
		body.appendChild(status);
		body.appendChild(panel);

		function reloadPage() {
			Promise.all([
				AudioCheckApi.get('/apps/audiocheck/api/playlists'),
				fetchFavoriteCount().catch(() => 0),
			]).then(([data, newFavCount]) => {
				renderPlaylistsIndex(body, data.playlists || [], newFavCount);
			}).catch((e) => {
				status.textContent = e.message || t('audiocheck', 'Request failed.');
			});
		}

		const openAll = playlists.length === 0;
		renderFavoritesGroup(host, favCount, openAll, reloadPage);
		const openFirst = playlists.length === 1;
		playlists.forEach((pl, idx) => {
			renderUserPlaylistGroup(host, pl, openFirst && idx === 0, reloadPage);
		});

		const totalPlaylists = playlists.length + 1;
		const trackTotal = playlists.reduce((sum, pl) => sum + (pl.trackCount || 0), 0) + (favCount || 0);
		status.textContent = t('audiocheck', '{count} items', { count: String(totalPlaylists) })
			+ ' — '
			+ AudioCheckTime.tracksLabel(trackTotal);

		if (playlists.length === 0 && favCount === 0) {
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

		const header = C.el('header', { className: 'ac-page-header ac-page-header--with-actions' });
		const titleEl = C.el('h1', { text: isFav ? t('audiocheck', 'Favorites') : t('audiocheck', 'Playlist') });
		const intro = C.el('p', {
			text: isFav
				? t('audiocheck', 'Tracks you starred in Now playing or Browse. They also sync with the Files app.')
				: '',
		});
		const actions = C.el('div', { className: 'ac-page-header__actions ac-toolbar ac-toolbar--wrap' });
		header.appendChild(C.el('div', { className: 'ac-page-header__intro' }, [titleEl, intro]));
		header.appendChild(actions);
		frag.appendChild(header);

		const body = C.el('div', { className: 'ac-page-body ac-playlists-page ac-facet-browse-page' });
		const toolbar = C.el('div', { className: 'ac-toolbar ac-collection-toolbar ac-facet-browse-toolbar' });
		const status = C.el('p', {
			className: 'ac-field__hint ac-facet-browse-status',
			attrs: { role: 'status', 'aria-live': 'polite' },
		});
		const panel = C.el('div', { className: 'ac-media-library-panel ac-facet-browse-panel' });
		const moreWrap = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-facet-browse-more' });
		body.appendChild(toolbar);
		body.appendChild(status);
		body.appendChild(panel);
		body.appendChild(moreWrap);
		frag.appendChild(body);

		function updateToolbar() {
			toolbar.replaceChildren();
			const search = C.el('input', {
				type: 'search',
				className: 'ac-input ac-collection-toolbar__search',
				attrs: {
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
			toolbar.appendChild(search);

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
				sortSel.appendChild(C.el('option', {
					value: opt.v,
					text: opt.l,
					attrs: opt.v === sort ? { selected: true } : {},
				}));
			});
			sortSel.addEventListener('change', () => {
				sort = sortSel.value;
				loadTracks(true);
			});
			toolbar.appendChild(sortSel);
		}

		function renderHeaderActions() {
			actions.textContent = '';
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
					AudioCheckPlayer.playQueue(playable, 0);
					AudioCheckRouter.navigate('now-playing', {}, true);
				},
			});
			const back = C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Back to playlists'),
				onClick: () => AudioCheckRouter.navigate('playlists', {}, true),
			});
			actions.appendChild(playAll);
			if (!isFav && playlistData) {
				const pl = playlistData;
				const addBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Add tracks'),
					onClick: () => addTracksModal(playlistId, () => load()),
				});
				const pinBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: pl.isPinned ? t('audiocheck', 'Unpin playlist') : t('audiocheck', 'Pin playlist'),
					onClick: () => {
						AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}', { isPinned: !pl.isPinned }, { params: { id: playlistId } })
							.then(() => load())
							.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
					},
				});
				const renameBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Rename'),
					onClick: () => renamePlaylistModal(playlistId, pl.name, () => load()),
				});
				const deleteBtn = C.el('button', {
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
				});
				actions.appendChild(addBtn);
				actions.appendChild(pinBtn);
				actions.appendChild(renameBtn);
				actions.appendChild(deleteBtn);
			}
			actions.appendChild(back);
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
					titleEl.textContent = playlistData.name || t('audiocheck', 'Playlist');
					intro.textContent = '';
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
			frag.appendChild(C.pageHeader(
				t('audiocheck', 'Playlists'),
				t('audiocheck', 'Built-in Favorites and playlists you create.'),
				createBtn,
			));

			const body = C.el('div', { className: 'ac-page-body ac-playlists-page ac-facet-browse-page' });
			body.appendChild(C.el('div', {
				className: 'ac-playlists-loading',
				attrs: { role: 'status', 'aria-live': 'polite' },
			}, [
				C.el('span', { className: 'ac-skeleton ac-skeleton--title' }),
				C.el('span', { className: 'ac-skeleton ac-skeleton--card' }),
			]));
			frag.appendChild(body);

			Promise.all([
				AudioCheckApi.get('/apps/audiocheck/api/playlists'),
				fetchFavoriteCount().catch(() => 0),
			]).then(([data, favCount]) => {
				renderPlaylistsIndex(body, data.playlists || [], favCount);
			}).catch((e) => {
				body.textContent = '';
				body.appendChild(C.emptyState(
					t('audiocheck', 'Could not load playlists'),
					e.message || t('audiocheck', 'Request failed.'),
					{ icon: 'playlist' },
				));
			});

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
