(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;

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
					status.textContent = '…';
					AudioCheckApi.get('/apps/audiocheck/api/tracks', { q, limit: 30 }).then((data) => {
						if (mySeq !== seq) return;
						ul.textContent = '';
						const items = data.items || [];
						if (!items.length) {
							status.textContent = t('audiocheck', 'No matching tracks.');
							return;
						}
						status.textContent = t('audiocheck', '{count} tracks', { count: String(items.length) });
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
				t('audiocheck', 'Your curated playlists.'),
				createBtn,
			));

			const body = C.el('div', { className: 'ac-page-body' });
			frag.appendChild(body);

			AudioCheckApi.get('/apps/audiocheck/api/playlists').then((data) => {
				body.textContent = '';
				const list = data.playlists || [];
				if (!list.length) {
					body.appendChild(C.emptyState(
						t('audiocheck', 'No playlists yet'),
						t('audiocheck', 'Create a playlist to group your favorite tracks.'),
						{ icon: 'playlist' },
					));
					return;
				}
				const grid = C.el('div', { className: 'ac-grid ac-playlist-grid' });
				list.forEach((pl) => {
					const card = C.el('article', {
						className: 'ac-card ac-card--media ac-playlist-card' + (pl.isPinned ? ' ac-playlist-card--pinned' : ''),
						tabindex: '0',
						role: 'button',
						'aria-label': pl.isPinned ? pl.name + ' (' + t('audiocheck', 'Pinned') + ')' : pl.name,
						onClick: () => AudioCheckRouter.navigate('playlist', { playlistId: pl.id }, true),
						onKeydown: (e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								AudioCheckRouter.navigate('playlist', { playlistId: pl.id }, true);
							}
						},
					});
					const iconWrap = C.el('div', { className: 'ac-playlist-card__icon', 'aria-hidden': 'true', text: pl.isPinned ? '★' : '♫' });
					card.appendChild(iconWrap);
					card.appendChild(C.el('h3', { className: 'ac-card__title', text: pl.name }));
					if (pl.trackCount != null) {
						card.appendChild(C.el('p', {
							className: 'ac-card__subtitle',
							text: t('audiocheck', '{count} tracks', { count: String(pl.trackCount) }),
						}));
					}
					grid.appendChild(card);
				});
				body.appendChild(grid);
			}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));

			return frag;
		},
	});

	AudioCheckRouter.register('playlist', {
		render(params) {
			const playlistId = params.playlistId;
			const frag = document.createDocumentFragment();
			const header = C.el('header', { className: 'ac-page-header' });
			const titleEl = C.el('h1', { text: t('audiocheck', 'Playlist') });
			const actions = C.el('div', { className: 'ac-toolbar ac-toolbar--wrap' });
			header.appendChild(titleEl);
			header.appendChild(actions);
			frag.appendChild(header);

			const ul = C.el('ul', { className: 'ac-track-list' });
			frag.appendChild(ul);

			function renderPlaylist(pl) {
				titleEl.textContent = pl.name || t('audiocheck', 'Playlist');
				actions.textContent = '';

				const playable = (pl.items || []).filter((x) => !x.unavailable);
				const playAll = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--primary',
					text: t('audiocheck', 'Play all'),
					disabled: playable.length === 0,
					onClick: () => AudioCheckPlayer.playQueue(playable, 0),
				});
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
				const back = C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Back to playlists'),
					onClick: () => AudioCheckRouter.navigate('playlists', {}, true),
				});

				[playAll, addBtn, pinBtn, renameBtn, deleteBtn, back].forEach((b) => actions.appendChild(b));

				ul.textContent = '';
				if (!pl.items || !pl.items.length) {
					ul.appendChild(C.el('li', { className: 'ac-track-list__empty', text: t('audiocheck', 'This playlist is empty.') }));
					return;
				}

				function reorder(index, delta) {
					const items = pl.items.slice();
					const target = index + delta;
					if (target < 0 || target >= items.length) return;
					const ids = items.map((it) => it.id);
					const tmp = ids[index];
					ids[index] = ids[target];
					ids[target] = tmp;
					AudioCheckApi.put('/apps/audiocheck/api/playlists/{id}/items/reorder', { itemIds: ids }, { params: { id: playlistId } })
						.then(() => load())
						.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
				}

				pl.items.forEach((track, i) => {
					const playIndex = playable.indexOf(track);
					ul.appendChild(C.trackRow(track, () => {
						if (playIndex >= 0) AudioCheckPlayer.playQueue(playable, playIndex);
					}, {
						onRemove: () => {
							AudioCheckApi.del('/apps/audiocheck/api/playlist-items/{id}', null, { params: { id: track.id } })
								.then(() => load())
								.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
						},
						removeLabel: t('audiocheck', 'Remove from playlist'),
						onMoveUp: i > 0 ? () => reorder(i, -1) : null,
						onMoveDown: i < pl.items.length - 1 ? () => reorder(i, 1) : null,
						moveUpDisabled: i === 0,
						moveDownDisabled: i === pl.items.length - 1,
					}));
				});
			}

			function load() {
				AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: playlistId } })
					.then((data) => renderPlaylist(data.playlist || {}))
					.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
			}

			load();
			return frag;
		},
	});
})();
