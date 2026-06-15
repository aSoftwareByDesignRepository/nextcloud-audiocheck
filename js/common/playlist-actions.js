(function () {
	'use strict';

	const C = window.AudioCheckComponents;

	function shuffleArray(arr) {
		const a = arr.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}

	function startPlayback(tracks, index, closeModal) {
		if (!tracks.length) return;
		const idx = typeof index === 'number' && index >= 0 ? index : 0;
		AudioCheckPlayer.playQueue(tracks, idx);
		if (typeof closeModal === 'function') closeModal(true);
		if (window.AudioCheckRouter) {
			AudioCheckRouter.navigate('now-playing', {}, true);
		}
	}

	function collectionKindLabel(kind) {
		if (kind === 'audiobook') return t('audiocheck', 'Audiobook');
		return t('audiocheck', 'Music');
	}

	function collectionMetaLine(playable, allTracks, meta) {
		const parts = [];
		if (meta && meta.kind) parts.push(collectionKindLabel(meta.kind));
		parts.push(t('audiocheck', '{count} tracks', { count: String(allTracks.length) }));
		const totalMs = AudioCheckTime.sumDurationMs(playable);
		if (totalMs > 0) {
			parts.push(AudioCheckTime.formatDuration(totalMs));
		}
		return parts.join(' · ');
	}

	/**
	 * @param {number|number[]} fileIds
	 */
	function openAddToPlaylist(fileIds) {
		const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
		if (!ids.length) return;

		C.openModal({
			title: t('audiocheck', 'Add to playlist'),
			primaryLabel: t('audiocheck', 'Done'),
			cancelLabel: t('audiocheck', 'Close'),
			render() {
				const status = C.createElement('p', {
					class: 'ac-field__hint',
					attrs: { role: 'status', 'aria-live': 'polite' },
					text: '…',
				});
				const list = C.createElement('ul', { class: 'ac-playlist-pick-list' });
				const wrap = C.createElement('div', {}, [status, list]);

				AudioCheckApi.get('/apps/audiocheck/api/playlists').then((data) => {
					const playlists = data.playlists || [];
					list.textContent = '';
					if (!playlists.length) {
						status.textContent = t('audiocheck', 'No playlists yet. Create one first.');
						return;
					}
					status.textContent = t('audiocheck', 'Choose a playlist.');
					playlists.forEach((pl) => {
						const li = C.createElement('li', { class: 'ac-playlist-pick-list__item' });
						const btn = C.createElement('button', {
							type: 'button',
							className: 'ac-btn ac-btn--text',
							text: pl.name,
							onClick: async () => {
								btn.disabled = true;
								try {
									for (const fileId of ids) {
										await AudioCheckApi.post('/apps/audiocheck/api/playlists/{id}/items', { fileId }, { params: { id: pl.id } });
									}
									AudioCheckMessaging.toast(t('audiocheck', 'Added to playlist.'));
								} catch (e) {
									AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
								} finally {
									btn.disabled = false;
								}
							},
						});
						li.appendChild(btn);
						list.appendChild(li);
					});
				}).catch((e) => {
					status.textContent = e.message || t('audiocheck', 'Request failed.');
				});

				return wrap;
			},
			onSubmit: () => true,
		});
	}

	function openBuildPlaylistFromCollection(collectionKey, defaultName) {
		C.openModal({
			title: t('audiocheck', 'Create playlist from collection'),
			primaryLabel: t('audiocheck', 'Create'),
			cancelLabel: t('audiocheck', 'Cancel'),
			render() {
				const input = C.createElement('input', {
					type: 'text',
					id: 'ac-build-pl-name',
					className: 'ac-input',
					attrs: {
						'aria-label': t('audiocheck', 'Playlist name'),
						maxlength: '255',
					},
					value: defaultName || '',
				});
				return C.createElement('div', { class: 'ac-form-row' }, [
					C.createElement('label', { attrs: { for: 'ac-build-pl-name' }, text: t('audiocheck', 'Playlist name') }),
					input,
				]);
			},
			onSubmit: () => {
				const input = document.getElementById('ac-build-pl-name');
				const name = (input && input.value || '').trim();
				if (!name) {
					AudioCheckMessaging.toast(t('audiocheck', 'Enter a playlist name.'), 'warning');
					return false;
				}
				AudioCheckApi.post('/apps/audiocheck/api/playlists/build', { name, collectionKey })
					.then((r) => {
						AudioCheckMessaging.toast(t('audiocheck', 'Playlist created.'));
						if (r.playlist && r.playlist.id) {
							AudioCheckRouter.navigate('playlist', { playlistId: r.playlist.id }, true);
						}
					})
					.catch((e) => AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error'));
				return true;
			},
		});
	}

	function openTracksSheet(title, allTracks, collectionKey, meta) {
		const tracks = (allTracks || []).filter((tr) => !tr.unavailable);
		const unavailableCount = (allTracks || []).length - tracks.length;
		C.openModal({
			title: title || t('audiocheck', 'Collection'),
			dialogClass: 'ac-modal__dialog--wide',
			primaryLabel: t('audiocheck', 'Play all'),
			cancelLabel: t('audiocheck', 'Close'),
			render(ctx) {
				const closeModal = ctx && typeof ctx.close === 'function' ? ctx.close : null;

				const summary = C.createElement('div', { className: 'ac-collection-detail__summary' });
				if (meta && meta.subtitle) {
					summary.appendChild(C.createElement('p', {
						className: 'ac-collection-detail__artist',
						text: meta.subtitle,
					}));
				}
				summary.appendChild(C.createElement('p', {
					className: 'ac-collection-detail__meta',
					attrs: { role: 'status' },
					text: collectionMetaLine(tracks, allTracks || [], meta),
				}));
				if (unavailableCount > 0) {
					summary.appendChild(C.createElement('p', {
						className: 'ac-field__hint ac-collection-detail__warn',
						attrs: { role: 'note' },
						text: t('audiocheck', '{count} unavailable tracks are hidden.', { count: String(unavailableCount) }),
					}));
				}

				const actions = C.createElement('div', {
					className: 'ac-collection-detail__actions',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Collection actions') },
				});
				const playAllBtn = C.createElement('button', {
					type: 'button',
					className: 'ac-btn ac-btn--primary',
					text: t('audiocheck', 'Play all'),
					disabled: tracks.length === 0,
					onClick: () => startPlayback(tracks, 0, closeModal),
				});
				const shuffleBtn = C.createElement('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Shuffle play'),
					disabled: tracks.length === 0,
					onClick: () => {
						AudioCheckPlayer.setShuffle(true);
						startPlayback(shuffleArray(tracks), 0, closeModal);
					},
				});
				const addPl = C.createElement('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Add all to playlist'),
					disabled: tracks.length === 0,
					onClick: () => openAddToPlaylist(tracks.map((tr) => tr.fileId)),
				});
				actions.appendChild(playAllBtn);
				actions.appendChild(shuffleBtn);
				actions.appendChild(addPl);
				if (collectionKey) {
					actions.appendChild(C.createElement('button', {
						type: 'button',
						className: 'ac-btn',
						text: t('audiocheck', 'Create playlist from collection'),
						disabled: tracks.length === 0,
						onClick: () => openBuildPlaylistFromCollection(collectionKey, title || t('audiocheck', 'Collection')),
					}));
				}

				const trackSection = C.createElement('section', {
					className: 'ac-collection-detail__tracks',
					attrs: { 'aria-labelledby': 'ac-collection-tracks-heading' },
				});
				trackSection.appendChild(C.createElement('h3', {
					id: 'ac-collection-tracks-heading',
					className: 'ac-section__title ac-collection-detail__tracks-title',
					text: t('audiocheck', 'Tracks'),
				}));

				const ul = C.createElement('ul', { className: 'ac-track-list ac-track-list--collection' });
				if (!allTracks || !allTracks.length) {
					ul.appendChild(C.createElement('li', {
						class: 'ac-track-list__empty',
						text: t('audiocheck', 'Nothing here yet'),
					}));
				} else {
					allTracks.forEach((track) => {
						const playable = tracks.indexOf(track);
						ul.appendChild(C.trackRow(track, () => {
							if (playable >= 0) startPlayback(tracks, playable, closeModal);
						}, {
							onAddPlaylist: track.unavailable ? null : () => openAddToPlaylist(track.fileId),
						}));
					});
				}
				trackSection.appendChild(ul);

				return C.createElement('div', { class: 'ac-collection-detail' }, [summary, actions, trackSection]);
			},
			onSubmit: () => {
				startPlayback(tracks, 0, null);
				return true;
			},
		});
	}

	function openTrackListFromApi(title, params) {
		AudioCheckApi.get('/apps/audiocheck/api/tracks', params).then((data) => {
			openTracksSheet(title, data.items || []);
		}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
	}

	function openCollectionDetail(collectionKey, titleHint) {
		AudioCheckApi.get('/apps/audiocheck/api/collections/{key}', null, { params: { key: collectionKey } }).then((data) => {
			const col = data.collection || {};
			openTracksSheet(col.title || titleHint || t('audiocheck', 'Collection'), col.tracks || [], collectionKey, {
				subtitle: col.subtitle || '',
				kind: col.kind || '',
			});
		}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
	}

	function shufflePinnedPlaylist() {
		AudioCheckApi.get('/apps/audiocheck/api/playlists').then((data) => {
			const list = data.playlists || [];
			const pinned = list.find((p) => p.isPinned) || list[0];
			if (!pinned) {
				AudioCheckMessaging.toast(t('audiocheck', 'Create a playlist first.'), 'warning');
				return;
			}
			AudioCheckApi.get('/apps/audiocheck/api/playlists/{id}', null, { params: { id: pinned.id } }).then((r) => {
				const tracks = (r.playlist.items || []).filter((x) => !x.unavailable);
				if (!tracks.length) {
					AudioCheckMessaging.toast(t('audiocheck', 'This playlist is empty.'), 'warning');
					return;
				}
				AudioCheckPlayer.setShuffle(true);
				AudioCheckPlayer.playQueue(shuffleArray(tracks), 0);
				AudioCheckMessaging.toast(t('audiocheck', 'Shuffling: {name}', { name: pinned.name }));
			}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
		}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
	}

	window.AudioCheckPlaylistActions = {
		openAddToPlaylist,
		openCollectionDetail,
		openTracksSheet,
		openTrackListFromApi,
		shufflePinnedPlaylist,
	};
})();
