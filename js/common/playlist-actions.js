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

	function startPlayback(tracks, index, closeModal, playbackOptions) {
		if (!tracks.length) return;
		const idx = typeof index === 'number' && index >= 0 ? index : 0;
		const opts = playbackOptions || {};
		if (window.AudioCheckPlaybackStart) {
			AudioCheckPlaybackStart.startCollectionPlayback(tracks, Object.assign({ startIndex: idx }, opts));
		} else {
			AudioCheckPlayer.playQueue(tracks, idx);
			if (window.AudioCheckRouter) AudioCheckRouter.navigate('now-playing', {}, true);
		}
		if (typeof closeModal === 'function') closeModal(true);
	}

	function shuffleAndPlay(tracks, closeModal) {
		AudioCheckPlayer.setShuffle(true);
		startPlayback(tracks, 0, closeModal, { playbackMode: 'sequential', shuffle: true });
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
		const count = meta && meta.trackCount != null ? meta.trackCount : (allTracks || []).length;
		parts.push(AudioCheckTime.tracksLabel(count));
		const totalMs = AudioCheckTime.sumDurationMs(playable);
		if (totalMs > 0) {
			parts.push(AudioCheckTime.formatDuration(totalMs));
		}
		return parts.join(' · ');
	}

	function collectionListenedCounts(allTracks) {
		const indexed = (allTracks || []).filter((tr) => tr && !tr.unavailable);
		const listened = indexed.filter((tr) => tr.listened || tr.finished).length;
		return {
			listened,
			total: indexed.length,
			fullyListened: indexed.length > 0 && listened >= indexed.length,
		};
	}

	function toggleCollectionListened(collectionKey, allTracks, nextListened, listenedBtn, statusEl) {
		if (!collectionKey) return;
		listenedBtn.disabled = true;
		AudioCheckApi.put('/apps/audiocheck/api/collections/{key}/listened', { listened: nextListened }, { params: { key: collectionKey } })
			.then((data) => {
				const col = data.collection || {};
				const refreshed = Array.isArray(col.tracks) ? col.tracks : [];
				const byId = {};
				refreshed.forEach((tr) => {
					if (tr && tr.fileId) byId[tr.fileId] = tr;
				});
				allTracks.forEach((tr) => {
					const next = byId[tr.fileId];
					if (next) {
						tr.listened = !!next.listened;
						tr.finished = !!next.finished;
					}
				});
				const counts = collectionListenedCounts(allTracks);
				if (statusEl) {
					statusEl.textContent = counts.total > 0
						? t('audiocheck', '{listened} of {total} tracks listened', {
							listened: String(counts.listened),
							total: String(counts.total),
						})
						: '';
				}
				const label = counts.fullyListened
					? t('audiocheck', 'Mark collection as not listened')
					: t('audiocheck', 'Mark collection as listened');
				listenedBtn.querySelector('.ac-btn__label').textContent = label;
				listenedBtn.setAttribute('aria-pressed', counts.fullyListened ? 'true' : 'false');
				const skipped = Number(data.skippedCount || 0);
				let msg = nextListened
					? t('audiocheck', 'Collection marked as listened.')
					: t('audiocheck', 'Collection marked as not listened.');
				if (skipped > 0) {
					msg += ' ' + t('audiocheck', '{count} unavailable tracks are hidden.', { count: String(skipped) });
				}
				AudioCheckMessaging.toast(msg);
			})
			.catch((e) => AudioCheckMessaging.toast(e.message, 'error'))
			.finally(() => { listenedBtn.disabled = false; });
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
					text: t('audiocheck', 'Loading…'),
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
				const trackCount = meta && meta.trackCount != null ? meta.trackCount : all.length;
				const listenedCounts = meta && meta.listenedCount != null
					? {
						listened: Number(meta.listenedCount),
						total: trackCount,
						fullyListened: !!meta.fullyListened,
					}
					: collectionListenedCounts(all);
				let listenedStatusEl = null;
				if (collectionKey && listenedCounts.total > 0) {
					listenedStatusEl = C.createElement('p', {
						className: 'ac-collection-detail__listened',
						attrs: { role: 'status' },
						text: t('audiocheck', '{listened} of {total} tracks listened', {
							listened: String(listenedCounts.listened),
							total: String(listenedCounts.total),
						}),
					});
					intro.appendChild(listenedStatusEl);
				}
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

				function mountPlaybackActions(showResumeChoice, continueItems) {
					actions.textContent = '';
					const PS = window.AudioCheckPlaybackStart;
					if (tracks.length > 1 && PS) {
						const fileIds = tracks.map((tr) => tr.fileId);
						const resumeIndex = showResumeChoice
							? PS.findResumeQueueIndex(fileIds, continueItems)
							: 0;
						actions.appendChild(PS.renderPlaybackStartActions({
							trackCount: tracks.length,
							showResumeChoice,
							disabled: !hasPlayable,
							onPlayFromStart: () => startPlayback(tracks, 0, closeModal, { playbackMode: 'sequential' }),
							onContinue: showResumeChoice
								? () => {
									const anchorItem = (continueItems || []).find((item) => {
										return item.fileId === fileIds[resumeIndex];
									});
									const positionMs = anchorItem && !anchorItem.finished
										? Math.max(0, anchorItem.positionMs || 0)
										: 0;
									startPlayback(tracks, resumeIndex, closeModal, {
										playbackMode: 'resume',
										resumeAnchorIndex: resumeIndex,
										positionMs,
									});
								}
								: undefined,
							onShuffle: tracks.length > 1
								? () => shuffleAndPlay(tracks, closeModal)
								: undefined,
						}));
					} else {
						actions.appendChild(actionButton(
							labels.play, 'play', 'ac-btn--primary',
							() => startPlayback(tracks, 0, closeModal),
							{ disabled: !hasPlayable, autofocus: true },
						));
						if (tracks.length > 1) {
							actions.appendChild(actionButton(
								t('audiocheck', 'Shuffle play'), 'shuffle', null,
								() => shuffleAndPlay(tracks, closeModal),
								{ disabled: !hasPlayable },
							));
						}
					}
				}

				if (tracks.length > 1 && window.AudioCheckPlaybackStart) {
					AudioCheckPlaybackStart.fetchContinueItems().then((continueItems) => {
						const fileIds = tracks.map((tr) => tr.fileId);
						const showResumeChoice = AudioCheckPlaybackStart.hasResumableProgress(fileIds, continueItems);
						mountPlaybackActions(showResumeChoice, continueItems);
					}).catch(() => mountPlaybackActions(false, []));
				} else {
					mountPlaybackActions(false, []);
				}
				actions.appendChild(actionButton(
					labels.addQueue, 'queue', null,
					() => addAllToQueue(tracks, closeModal),
					{ disabled: !hasPlayable },
				));
				if (collectionKey && listenedCounts.total > 0) {
					const markLabel = listenedCounts.fullyListened
						? t('audiocheck', 'Mark collection as not listened')
						: t('audiocheck', 'Mark collection as listened');
					const listenedBtn = actionButton(
						markLabel,
						listenedCounts.fullyListened ? 'checkmark' : 'checkmark-outline',
						listenedCounts.fullyListened ? 'ac-btn--success' : null,
						() => toggleCollectionListened(
							collectionKey,
							all,
							!listenedCounts.fullyListened,
							listenedBtn,
							listenedStatusEl,
						),
						{
							disabled: !hasPlayable,
							pressed: listenedCounts.fullyListened,
						},
					);
					listenedBtn.setAttribute('aria-pressed', listenedCounts.fullyListened ? 'true' : 'false');
					actions.appendChild(listenedBtn);
				}
				root.appendChild(actions);

				if (showTrackList) {
					const ul = C.createElement('ul', { className: 'ac-track-list ac-track-list--collection' });
					function renderTrackRows() {
						ul.textContent = '';
						if (!all.length) {
							ul.appendChild(C.createElement('li', {
								class: 'ac-track-list__empty',
								text: t('audiocheck', 'Nothing here yet'),
							}));
							return;
						}
						all.forEach((track) => {
							const playable = tracks.indexOf(track);
							const rowOpts = window.AudioCheckTrackListUi
								? AudioCheckTrackListUi.trackRowOptions(track, {
									onAddPlaylist: track.unavailable ? null : () => openAddToPlaylist(track.fileId),
									onEnqueue: track.unavailable ? null : () => enqueueTrack(track),
								})
								: {
									onAddPlaylist: track.unavailable ? null : () => openAddToPlaylist(track.fileId),
									onEnqueue: track.unavailable ? null : () => enqueueTrack(track),
								};
							ul.appendChild(C.trackRow(track, () => {
								if (playable >= 0) {
									if (tracks.length > 1 && typeof AudioCheckPlayer.playQueueFromHere === 'function') {
										AudioCheckPlayer.playQueueFromHere(tracks, playable);
										if (typeof closeModal === 'function') closeModal(true);
										if (window.AudioCheckRouter) AudioCheckRouter.navigate('now-playing', {}, true);
									} else {
										startPlayback(tracks, playable, closeModal);
									}
								}
							}, rowOpts));
						});
					}
					renderTrackRows();
					const trackSection = C.sectionCard(
						t('audiocheck', 'Tracks ({count})', { count: String(trackCount) }),
						null,
						ul,
						null,
						'ac-collection-tracks-heading',
					);
					trackSection.classList.add('ac-collection-detail__tracks');
					if (meta && typeof meta.loadMoreTracks === 'function' && all.length < trackCount) {
						const loadMoreWrap = C.createElement('div', { className: 'ac-collection-detail__load-more' });
						const loadMoreBtn = actionButton(
							t('audiocheck', 'Load more'),
							'chevron-down',
							'ac-btn--secondary',
							() => {
								loadMoreBtn.disabled = true;
								Promise.resolve(meta.loadMoreTracks()).then((updated) => {
									all.splice(0, all.length, ...(updated || []));
									tracks.splice(0, tracks.length);
									all.filter((tr) => tr && !tr.unavailable).forEach((tr) => tracks.push(tr));
									renderTrackRows();
								}).catch((e) => {
									AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
								}).finally(() => {
									loadMoreBtn.disabled = false;
								});
							},
						);
						loadMoreWrap.appendChild(loadMoreBtn);
						trackSection.appendChild(loadMoreWrap);
					}
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
		const COLLECTION_PAGE_SIZE = 48;
		let page = 1;
		let collectionMeta = null;
		let allLoadedTracks = [];

		function fetchPage() {
			return AudioCheckApi.get('/apps/audiocheck/api/collections/{key}', null, {
				params: { key: collectionKey, page, limit: COLLECTION_PAGE_SIZE },
			}).then((data) => {
				const col = data.collection || {};
				if (!collectionMeta) {
					collectionMeta = col;
				}
				const batch = col.tracks || [];
				allLoadedTracks = allLoadedTracks.concat(batch);
				return col;
			});
		}

		fetchPage().then((col) => {
			const trackCount = col.trackCount != null ? col.trackCount : allLoadedTracks.length;
			openTracksSheet(col.title || titleHint || t('audiocheck', 'Collection'), allLoadedTracks, collectionKey, {
				subtitle: col.subtitle || '',
				kind: col.kind || '',
				trackCount,
				listenedCount: col.listenedCount,
				fullyListened: col.fullyListened,
				loadMoreTracks: trackCount > allLoadedTracks.length
					? () => {
						page += 1;
						return fetchPage().then(() => allLoadedTracks.slice());
					}
					: null,
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

	function mountFolderListenedBar(bodyWrap, folderPath, kind, reloadTracks) {
		if (!bodyWrap || !folderPath) return null;
		const uid = 'ac-folder-listened-' + String(Math.random()).slice(2, 10);
		const headingId = uid + '-heading';
		const statusId = uid + '-status';

		const wrap = C.createElement('section', {
			className: 'ac-folder-listened',
			attrs: { 'aria-labelledby': headingId },
		});
		wrap.appendChild(C.createElement('h3', {
			id: headingId,
			className: 'ac-sr-only',
			text: t('audiocheck', 'Listened progress'),
		}));

		const progressWrap = C.createElement('div', {
			className: 'ac-folder-listened__progress',
			attrs: {
				role: 'progressbar',
				'aria-valuemin': '0',
				'aria-valuemax': '0',
				'aria-valuenow': '0',
				'aria-labelledby': statusId,
			},
		});
		const progressFill = C.createElement('div', {
			className: 'ac-folder-listened__progress-fill',
			attrs: { 'aria-hidden': 'true' },
		});
		progressWrap.appendChild(progressFill);

		const statusEl = C.createElement('p', {
			id: statusId,
			className: 'ac-folder-listened__status',
			attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
			text: '',
		});

		const meta = C.createElement('div', { className: 'ac-folder-listened__meta' }, [progressWrap, statusEl]);

		const markBtn = C.createElement('button', {
			type: 'button',
			className: 'ac-btn ac-btn--icon ac-folder-listened__toggle',
			attrs: {
				'aria-pressed': 'false',
				'aria-describedby': statusId,
				'aria-label': t('audiocheck', 'Mark folder as listened'),
				disabled: true,
			},
		});
		if (window.AudioCheckIcons) {
			AudioCheckIcons.mount(markBtn, 'circle');
		}

		function updateToggle(fully, total) {
			const label = fully
				? t('audiocheck', 'Mark folder as not listened')
				: t('audiocheck', 'Mark folder as listened');
			markBtn.setAttribute('aria-label', label);
			markBtn.setAttribute('aria-pressed', fully ? 'true' : 'false');
			markBtn.classList.toggle('ac-btn--success', fully);
			markBtn.disabled = total === 0;
			if (window.AudioCheckIcons) {
				AudioCheckIcons.mount(markBtn, fully ? 'circle-check' : 'circle');
			}
		}

		function applyStats(stats) {
			const listened = stats.listenedCount || 0;
			const total = stats.trackCount || 0;
			const fully = !!stats.fullyListened;
			const pct = total > 0 ? Math.min(100, Math.round((listened / total) * 100)) : 0;

			progressWrap.hidden = total === 0;
			progressWrap.setAttribute('aria-valuenow', String(listened));
			progressWrap.setAttribute('aria-valuemax', String(total));
			progressFill.style.width = pct + '%';

			statusEl.textContent = total > 0
				? t('audiocheck', '{listened} of {total} tracks listened', {
					listened: String(listened),
					total: String(total),
				})
				: t('audiocheck', 'No tracks in this folder.');

			updateToggle(fully, total);
			return fully;
		}

		function loadStats() {
			const params = { folder: folderPath };
			if (kind) params.kind = kind;
			return AudioCheckApi.get('/apps/audiocheck/api/folders/listened-stats', params)
				.then((data) => applyStats(data.stats || {}));
		}

		markBtn.addEventListener('click', () => {
			const next = markBtn.getAttribute('aria-pressed') !== 'true';
			markBtn.disabled = true;
			const body = { folder: folderPath, listened: next };
			if (kind) body.kind = kind;
			AudioCheckApi.put('/apps/audiocheck/api/folders/listened', body)
				.then((data) => {
					applyStats(data);
					const skipped = Number(data.skippedCount || 0);
					let msg = next
						? t('audiocheck', 'Folder marked as listened.')
						: t('audiocheck', 'Folder marked as not listened.');
					if (skipped > 0) {
						msg += ' ' + t('audiocheck', '{count} unavailable tracks are hidden.', { count: String(skipped) });
					}
					AudioCheckMessaging.toast(msg);
					if (typeof reloadTracks === 'function') reloadTracks();
				})
				.catch((e) => AudioCheckMessaging.toast(e.message, 'error'))
				.finally(() => { loadStats().catch(() => {}); });
		});

		wrap.appendChild(meta);
		wrap.appendChild(markBtn);
		bodyWrap.appendChild(wrap);
		loadStats().catch(() => {});
		return { refresh: loadStats };
	}

	window.AudioCheckPlaylistActions = {
		openAddToPlaylist,
		openCollectionDetail,
		openTracksSheet,
		openTrackListFromApi,
		shufflePinnedPlaylist,
		mountFolderListenedBar,
	};
})();
