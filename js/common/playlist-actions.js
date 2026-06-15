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

	function addAllToQueue(tracks, closeModal) {
		const playable = (tracks || []).filter((tr) => tr && !tr.unavailable);
		if (!playable.length) return;
		const added = AudioCheckPlayer.enqueueAll(playable);
		if (added === 0) {
			AudioCheckMessaging.toast(t('audiocheck', 'All tracks are already in the queue.'), 'info');
			return;
		}
		const msg = added === 1
			? t('audiocheck', '1 track added to queue.')
			: t('audiocheck', '{count} tracks added to queue.', { count: String(added) });
		AudioCheckMessaging.toast(msg);
		if (typeof closeModal === 'function') closeModal(true);
	}

	function collectionKindLabel(kind) {
		if (kind === 'audiobook') return t('audiocheck', 'Audiobook');
		return t('audiocheck', 'Music');
	}

	function collectionMetaLine(playable, allTracks, meta) {
		const parts = [];
		if (meta && meta.kind) parts.push(collectionKindLabel(meta.kind));
		parts.push(AudioCheckTime.tracksLabel((allTracks || []).length));
		const totalMs = AudioCheckTime.sumDurationMs(playable);
		if (totalMs > 0) {
			parts.push(AudioCheckTime.formatDuration(totalMs));
		}
		return parts.join(' · ');
	}

	function coverNode(track) {
		const wrap = C.createElement('div', {
			className: 'ac-collection-detail__cover-wrap',
			attrs: { 'aria-hidden': 'true' },
		});
		const fileId = track
			? (AudioCheckApi.validFileId(track.coverFileId) ?? AudioCheckApi.validFileId(track.fileId))
			: null;
		const url = fileId ? AudioCheckApi.coverUrl(fileId) : '';
		if (url) {
			wrap.appendChild(C.createElement('img', {
				className: 'ac-collection-detail__cover',
				src: url,
				alt: '',
				loading: 'lazy',
				decoding: 'async',
			}));
		} else {
			wrap.appendChild(C.createElement('div', {
				className: 'ac-collection-detail__cover ac-collection-detail__cover--placeholder',
			}));
		}
		return wrap;
	}

	function actionButton(label, iconName, extraClass, onClick, options) {
		const opts = options || {};
		const btn = C.createElement('button', {
			type: 'button',
			className: 'ac-btn' + (extraClass ? ' ' + extraClass : ''),
			disabled: !!opts.disabled,
			onClick,
		});
		if (iconName && window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg(iconName));
		}
		btn.appendChild(C.createElement('span', { class: 'ac-btn__label', text: label }));
		if (opts.autofocus && !opts.disabled) btn.setAttribute('autofocus', '');
		return btn;
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

	function collectionActionLabels(playableCount) {
		const one = playableCount === 1;
		return {
			play: one ? t('audiocheck', 'Play') : t('audiocheck', 'Play all'),
			addQueue: one ? t('audiocheck', 'Add to queue') : t('audiocheck', 'Add all to queue'),
			addPlaylist: one ? t('audiocheck', 'Add to playlist') : t('audiocheck', 'Add all to playlist'),
			createPlaylist: one
				? t('audiocheck', 'Save as new playlist')
				: t('audiocheck', 'Create playlist from collection'),
			actionsAria: one ? t('audiocheck', 'Track actions') : t('audiocheck', 'Collection actions'),
		};
	}

	function enqueueTrack(track) {
		if (!track || track.unavailable) return;
		if (AudioCheckPlayer.enqueue(track)) {
			AudioCheckMessaging.toast(t('audiocheck', 'Added to queue.'));
		}
	}

	function openTracksSheet(title, allTracks, collectionKey, meta) {
		const all = Array.isArray(allTracks) ? allTracks : [];
		const tracks = all.filter((tr) => tr && !tr.unavailable);
		const unavailableCount = all.length - tracks.length;
		const hasPlayable = tracks.length > 0;
		const labels = collectionActionLabels(tracks.length);
		const showTrackList = all.length > 1;

		C.openModal({
			title: title || t('audiocheck', 'Collection'),
			dialogClass: 'ac-modal__dialog--wide',
			hideDefaultActions: true,
			render(ctx) {
				const closeModal = ctx && typeof ctx.close === 'function' ? ctx.close : null;
				const root = C.createElement('div', {
					class: 'ac-collection-detail' + (tracks.length === 1 ? ' ac-collection-detail--single' : ''),
				});

				const hero = C.createElement('div', { className: 'ac-collection-detail__hero' });
				hero.appendChild(coverNode(tracks[0] || null));
				const intro = C.createElement('div', { className: 'ac-collection-detail__intro' });
				if (meta && meta.subtitle) {
					intro.appendChild(C.createElement('p', {
						className: 'ac-collection-detail__artist',
						text: meta.subtitle,
					}));
				}
				if (tracks.length === 1 && tracks[0]) {
					const trackTitle = tracks[0].title || tracks[0].fileName || '';
					if (trackTitle && trackTitle !== title) {
						intro.appendChild(C.createElement('p', {
							className: 'ac-collection-detail__track-title',
							text: trackTitle,
						}));
					}
				}
				intro.appendChild(C.createElement('p', {
					className: 'ac-collection-detail__meta',
					attrs: { role: 'status' },
					text: collectionMetaLine(tracks, all, meta),
				}));
				if (unavailableCount > 0) {
					intro.appendChild(C.createElement('p', {
						className: 'ac-field__hint ac-collection-detail__warn',
						attrs: { role: 'note' },
						text: t('audiocheck', '{count} unavailable tracks are hidden.', { count: String(unavailableCount) }),
					}));
				}
				hero.appendChild(intro);
				root.appendChild(hero);

				const actions = C.createElement('div', {
					className: 'ac-collection-detail__actions'
						+ (tracks.length === 1 ? ' ac-collection-detail__actions--single' : ''),
					attrs: { role: 'group', 'aria-label': labels.actionsAria },
				});
				actions.appendChild(actionButton(
					labels.play, 'play', 'ac-btn--primary',
					() => startPlayback(tracks, 0, closeModal),
					{ disabled: !hasPlayable, autofocus: true },
				));
				if (tracks.length > 1) {
					actions.appendChild(actionButton(
						t('audiocheck', 'Shuffle play'), 'shuffle', null,
						() => {
							AudioCheckPlayer.setShuffle(true);
							startPlayback(shuffleArray(tracks), 0, closeModal);
						},
						{ disabled: !hasPlayable },
					));
				}
				actions.appendChild(actionButton(
					labels.addQueue, 'queue', null,
					() => addAllToQueue(tracks, closeModal),
					{ disabled: !hasPlayable },
				));
				root.appendChild(actions);

				if (showTrackList) {
					const trackSection = C.createElement('section', {
						className: 'ac-collection-detail__tracks',
						attrs: { 'aria-labelledby': 'ac-collection-tracks-heading' },
					});
					trackSection.appendChild(C.createElement('h3', {
						id: 'ac-collection-tracks-heading',
						className: 'ac-section__title ac-collection-detail__tracks-title',
						text: t('audiocheck', 'Tracks ({count})', { count: String(all.length) }),
					}));
					const ul = C.createElement('ul', { className: 'ac-track-list ac-track-list--collection' });
					if (!all.length) {
						ul.appendChild(C.createElement('li', {
							class: 'ac-track-list__empty',
							text: t('audiocheck', 'Nothing here yet'),
						}));
					} else {
						all.forEach((track) => {
							const playable = tracks.indexOf(track);
							ul.appendChild(C.trackRow(track, () => {
								if (playable >= 0) startPlayback(tracks, playable, closeModal);
							}, {
								onAddPlaylist: track.unavailable ? null : () => openAddToPlaylist(track.fileId),
								onEnqueue: track.unavailable ? null : () => enqueueTrack(track),
							}));
						});
					}
					trackSection.appendChild(ul);
					root.appendChild(trackSection);
				}

				if (hasPlayable) {
					const more = C.createElement('div', {
						className: 'ac-collection-detail__more',
						attrs: { role: 'group', 'aria-label': t('audiocheck', 'More actions') },
					});
					more.appendChild(actionButton(
						labels.addPlaylist, 'add', 'ac-btn--text',
						() => openAddToPlaylist(tracks.map((tr) => tr.fileId)),
					));
					if (collectionKey) {
						more.appendChild(actionButton(
							labels.createPlaylist, 'queue', 'ac-btn--text',
							() => openBuildPlaylistFromCollection(collectionKey, title || t('audiocheck', 'Collection')),
						));
					}
					root.appendChild(more);
				}

				return root;
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

	function shuffleFavoriteTracks() {
		return AudioCheckApi.get('/apps/audiocheck/api/tracks', { favorite: '1', limit: 500, sort: 'title' })
			.then((data) => {
				const tracks = (data.items || []).filter((x) => !x.unavailable);
				if (!tracks.length) {
					AudioCheckMessaging.toast(t('audiocheck', 'No favorite tracks yet.'), 'warning');
					return;
				}
				AudioCheckPlayer.setShuffle(true);
				AudioCheckPlayer.playQueue(shuffleArray(tracks), 0);
				AudioCheckMessaging.toast(t('audiocheck', 'Shuffling: {name}', { name: t('audiocheck', 'Favorites') }));
			});
	}

	function shufflePinnedPlaylist() {
		AudioCheckApi.get('/apps/audiocheck/api/playlists').then((data) => {
			const list = data.playlists || [];
			const pinned = list.find((p) => p.isPinned) || list[0];
			if (!pinned) {
				shuffleFavoriteTracks().catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
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
