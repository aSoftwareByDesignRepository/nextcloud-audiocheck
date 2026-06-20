(function () {
	'use strict';

	const FACET_TRACK_LIMIT = 500;

	function isTrackListened(track) {
		return !!(track && (track.listened || track.finished));
	}

	function toggleListened(track) {
		const fileId = AudioCheckApi.validFileId(track.fileId);
		if (!fileId) {
			return Promise.reject(new Error(t('audiocheck', 'Request failed.')));
		}
		const next = !isTrackListened(track);
		return AudioCheckApi.put('/apps/audiocheck/api/tracks/{fileId}/listened', { listened: next }, { params: { fileId } })
			.then((r) => {
				track.listened = !!(r.progress && r.progress.listened);
				track.finished = !!(r.progress && r.progress.finished);
				syncListenedState(track);
				AudioCheckMessaging.toast(next
					? t('audiocheck', 'Marked as listened.')
					: t('audiocheck', 'Marked as not listened.'));
				return track;
			});
	}

	function syncListenedState(track) {
		const fileId = AudioCheckApi.validFileId(track.fileId);
		if (!fileId || !window.AudioCheckPlayer || typeof AudioCheckPlayer.getQueue !== 'function') {
			return;
		}
		const listened = !!track.listened;
		const finished = !!track.finished;
		AudioCheckPlayer.getQueue().forEach((q) => {
			if (q && AudioCheckApi.validFileId(q.fileId) === fileId) {
				q.listened = listened;
				q.finished = finished;
			}
		});
		document.dispatchEvent(new CustomEvent('audiocheck-listened-changed', {
			bubbles: true,
			detail: { fileId, listened, finished },
		}));
	}

	function trackRowOptions(track, extra) {
		if (track.unavailable) {
			return extra || {};
		}
		const PA = () => window.AudioCheckPlaylistActions;
		const base = {
			onToggleListened: (tr) => toggleListened(tr),
			onAddPlaylist: PA() ? () => PA().openAddToPlaylist(track.fileId) : null,
			onEnqueue: () => {
				if (!track || track.unavailable) return;
				if (AudioCheckPlayer.enqueue(track)) {
					AudioCheckMessaging.toast(t('audiocheck', 'Added to queue.'));
				}
			},
		};
		return extra ? { ...base, ...extra } : base;
	}

	function appendTracksToList(list, tracks, cache, C, displayMeta, rowOptionsForTrack) {
		const metaFn = displayMeta || ((tr) => tr);
		const rowOptsFn = rowOptionsForTrack || ((tr) => trackRowOptions(tr));
		tracks.forEach((track) => {
			let playIdx = -1;
			if (!track.unavailable) {
				playIdx = cache.length;
				cache.push(track);
			}
			list.appendChild(C.trackRow(metaFn(track), playIdx >= 0
				? () => AudioCheckPlayer.playQueue(cache, playIdx)
				: null, rowOptsFn(track)));
		});
	}

	function createPlayAllButton(C, label, onPlay) {
		const btn = C.el('button', {
			type: 'button',
			className: 'ac-btn ac-btn--icon ac-facet-group__play',
			attrs: { 'aria-label': t('audiocheck', 'Play all {kind}', { kind: label }) },
			onClick: (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.disabled = true;
				Promise.resolve(onPlay()).catch((e) => {
					AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
				}).finally(() => {
					btn.disabled = false;
				});
			},
		});
		if (window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg('play'));
		}
		return btn;
	}

	/**
	 * @param {object} opts
	 * @param {import('./components').AudioCheckComponents} opts.C
	 * @param {string} opts.label
	 * @param {number} opts.count
	 * @param {HTMLElement} opts.host
	 * @param {boolean} [opts.startOpen]
	 * @param {string} [opts.groupClassName]
	 * @param {() => Promise<{items: object[], total?: number}>} opts.loadTracks
	 * @param {() => Promise<object[]>} opts.playAllTracks
	 * @param {(track: object) => object} [opts.displayMeta]
	 * @param {(track: object) => object} [opts.rowOptionsForTrack]
	 * @param {(bodyWrap: HTMLElement, reload: () => void) => void} [opts.mountBodyExtra]
	 * @param {(summary: HTMLElement) => void} [opts.mountSummaryExtra]
	 */
	function renderExpandableTrackGroup(opts) {
		const C = opts.C;
		const cache = [];
		const details = C.el('details', {
			className: 'ac-media-folder-group ac-facet-group' + (opts.groupClassName ? ' ' + opts.groupClassName : ''),
			attrs: opts.startOpen ? { open: true } : {},
		});
		const summary = C.el('summary', { className: 'ac-media-folder-group__summary ac-facet-group__summary' });
		summary.appendChild(C.el('span', { className: 'ac-media-folder-group__name', text: opts.label }));
		summary.appendChild(C.el('span', {
			className: 'ac-media-folder-group__count',
			text: AudioCheckTime.tracksLabel(opts.count || 0),
		}));
		if (opts.mountSummaryExtra) {
			opts.mountSummaryExtra(summary);
		}
		summary.appendChild(createPlayAllButton(C, opts.label, async () => {
			const tracks = (await opts.playAllTracks()).filter((tr) => tr && !tr.unavailable);
			if (!tracks.length) {
				AudioCheckMessaging.toast(t('audiocheck', 'Nothing here yet'), 'warning');
				return;
			}
			AudioCheckPlayer.playQueue(tracks, 0);
			AudioCheckRouter.navigate('now-playing', {}, true);
		}));
		details.appendChild(summary);

		const bodyWrap = C.el('div', { className: 'ac-media-folder-group__body' });
		const list = C.el('ul', { className: 'ac-track-list' });
		bodyWrap.appendChild(list);
		details.appendChild(bodyWrap);
		opts.host.appendChild(details);

		let loaded = false;
		let trackPage = 1;
		let trackTotal = opts.count || 0;
		const TRACK_PAGE_SIZE = 48;

		function appendPage(data) {
			const tracks = data.items || [];
			trackTotal = data.total != null ? data.total : tracks.length;
			appendTracksToList(list, tracks, cache, C, opts.displayMeta, opts.rowOptionsForTrack);
			const countEl = details.querySelector('.ac-media-folder-group__count');
			if (countEl && trackTotal > 0) {
				countEl.textContent = AudioCheckTime.tracksLabel(trackTotal);
			}
			const existingMore = list.querySelector('.ac-facet-group__load-more');
			if (existingMore) existingMore.remove();
			if (trackTotal > cache.length) {
				const li = C.el('li', { className: 'ac-track-list__empty ac-facet-group__load-more' });
				const btn = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--secondary',
					text: t('audiocheck', 'Load more'),
					onClick: () => {
						btn.disabled = true;
						trackPage += 1;
						opts.loadTracks(trackPage).then((next) => {
							appendPage(next);
						}).catch((e) => {
							AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
						}).finally(() => {
							btn.disabled = false;
						});
					},
				});
				li.appendChild(btn);
				list.appendChild(li);
			}
		}

		function loadList() {
			if (loaded && trackPage === 1) return;
			if (!loaded) {
				loaded = true;
				trackPage = 1;
				list.appendChild(C.el('li', {
					className: 'ac-track-list__empty',
					text: t('audiocheck', 'Loading…'),
				}));
			}
			opts.loadTracks(trackPage).then((data) => {
				list.textContent = '';
				const tracks = data.items || [];
				if (!tracks.length) {
					list.appendChild(C.el('li', {
						className: 'ac-track-list__empty',
						text: t('audiocheck', 'Nothing here yet'),
					}));
					return;
				}
				appendPage(data);
			}).catch((e) => {
				list.textContent = '';
				list.appendChild(C.el('li', {
					className: 'ac-track-list__empty',
					text: e.message || t('audiocheck', 'Request failed.'),
				}));
			});
		}

		function reloadList() {
			loaded = false;
			cache.length = 0;
			list.textContent = '';
			loadList();
		}

		if (opts.mountBodyExtra) {
			opts.mountBodyExtra(bodyWrap, reloadList);
		}

		if (opts.startOpen) loadList();
		else details.addEventListener('toggle', () => { if (details.open) loadList(); });

		return { details, reload: reloadList };
	}

	window.AudioCheckTrackListUi = {
		FACET_TRACK_LIMIT,
		isTrackListened,
		toggleListened,
		syncListenedState,
		trackRowOptions,
		appendTracksToList,
		createPlayAllButton,
		renderExpandableTrackGroup,
	};
})();
