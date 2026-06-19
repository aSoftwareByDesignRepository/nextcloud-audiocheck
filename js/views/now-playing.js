(function () {
	'use strict';
	const C = AudioCheckComponents;

	function repeatLabel(mode) {
		if (mode === AudioCheckConstants.REPEAT_ONE) return t('audiocheck', 'Repeat one');
		if (mode === AudioCheckConstants.REPEAT_ALL) return t('audiocheck', 'Repeat all');
		return t('audiocheck', 'Repeat off');
	}

	function transportBtn(label, iconName, primary, onClick) {
		const btn = C.el('button', {
			type: 'button',
			className: 'ac-btn ac-transport-btn' + (primary ? ' ac-transport-btn--primary' : ''),
			attrs: { 'aria-label': label },
			onClick,
		});
		if (window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg(iconName));
		}
		return btn;
	}

	function nowActionBtn(label, iconName, onClick, options) {
		const opts = options || {};
		const classes = ['ac-btn', 'ac-now-action'];
		if (opts.variant) classes.push('ac-now-action--' + opts.variant);
		if (opts.active) classes.push('ac-now-action--active');
		const attrs = {};
		if (opts.pressed !== undefined) {
			attrs['aria-pressed'] = opts.pressed ? 'true' : 'false';
		}
		const btn = C.el('button', {
			type: 'button',
			className: classes.join(' '),
			attrs,
			disabled: !!opts.disabled,
			onClick,
		});
		if (iconName && window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg(iconName));
		}
		btn.appendChild(C.el('span', { className: 'ac-btn__label', text: label }));
		return btn;
	}

	AudioCheckRouter.register('now-playing', {
		render() {
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-now-playing__body' });

			const controls = C.el('div', { className: 'ac-player-controls' });
			const playbackActions = C.el('div', {
				className: 'ac-now-actions ac-playback-actions',
				attrs: { role: 'group', 'aria-label': t('audiocheck', 'Playback and track actions') },
			});
			const shuffleBtn = nowActionBtn(
				t('audiocheck', 'Shuffle off'),
				'shuffle',
				() => AudioCheckPlayer.setShuffle(!AudioCheckPlayer.getShuffle()),
			);
			shuffleBtn.id = 'ac-shuffle-btn';
			const repeatBtn = nowActionBtn(
				repeatLabel(AudioCheckPlayer.getRepeatMode()),
				'repeat',
				() => AudioCheckPlayer.cycleRepeat(),
			);
			repeatBtn.id = 'ac-repeat-btn';
			const trackActions = C.el('div', { className: 'ac-playback-actions__track' });
			playbackActions.appendChild(shuffleBtn);
			playbackActions.appendChild(repeatBtn);
			playbackActions.appendChild(trackActions);
			controls.appendChild(playbackActions);
			const speed = C.el('select', {
				id: 'ac-speed-select',
				className: 'ac-input ac-now-speed',
			});
			AudioCheckConstants.SPEED_PRESETS.forEach((s) => {
				const o = document.createElement('option');
				o.value = String(s);
				o.textContent = (s / 100).toFixed(2) + '×';
				speed.appendChild(o);
			});
			speed.addEventListener('change', () => AudioCheckPlayer.setSpeed(parseInt(speed.value, 10)));
			const speedField = C.el('div', { className: 'ac-now-speed-field' });
			speedField.appendChild(C.el('label', {
				className: 'ac-now-speed-field__label',
				attrs: { for: 'ac-speed-select' },
				text: t('audiocheck', 'Speed'),
			}));
			speedField.appendChild(speed);
			controls.appendChild(speedField);
			controls.appendChild(C.volumeControl({ idPrefix: 'ac-now' }));
			const settingsSection = C.el('div', {
				className: 'ac-now-card__settings',
				attrs: { 'aria-labelledby': 'ac-now-settings-heading' },
			});
			settingsSection.appendChild(C.el('h3', {
				id: 'ac-now-settings-heading',
				className: 'ac-now-card__settings-title',
				text: t('audiocheck', 'Playback'),
			}));
			settingsSection.appendChild(controls);

			const queueSection = C.el('section', {
				className: 'ac-section ac-now-panel ac-now-panel--queue',
				id: 'ac-queue-section',
				attrs: { hidden: true, 'aria-labelledby': 'ac-queue-heading' },
			});
			const queueHead = C.el('div', { className: 'ac-now-queue__head' });
			queueHead.appendChild(C.el('h2', {
				id: 'ac-queue-heading',
				className: 'ac-section__title ac-now-queue__title',
				text: t('audiocheck', 'Queue'),
			}));
			const queueMeta = C.el('p', {
				id: 'ac-queue-meta',
				className: 'ac-now-queue__meta',
				attrs: { 'aria-live': 'polite' },
			});
			queueHead.appendChild(queueMeta);
			const queueClear = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--text ac-now-queue__clear',
				text: t('audiocheck', 'Clear queue'),
				onClick: () => AudioCheckPlayer.clearQueue(),
			});
			queueHead.appendChild(queueClear);
			queueSection.appendChild(queueHead);
			const queueUl = C.el('ul', { className: 'ac-track-list ac-now-queue', id: 'ac-queue-list' });
			queueSection.appendChild(queueUl);

			const chaptersSection = C.el('section', {
				className: 'ac-section ac-now-panel',
				id: 'ac-chapters-section',
				attrs: { hidden: true },
			});
			chaptersSection.appendChild(C.el('h2', { className: 'ac-section__title', text: t('audiocheck', 'Chapters') }));
			const chaptersUl = C.el('ul', { className: 'ac-chapter-list', id: 'ac-chapter-list' });
			chaptersSection.appendChild(chaptersUl);

			let playBtn = null;
			let seekInput = null;
			let posEl = null;
			let durEl = null;
			let renderedFileId = 0;
			let renderedEmpty = false;
			let renderedListenedKey = '';
			let lastQueueSig = '';
			let seekDragging = false;
			let idleMode = '';

			function playContinueItem(item) {
				const positionMs = item.finished ? 0 : (item.positionMs || 0);
				if (typeof item.playbackSpeed === 'number' && item.playbackSpeed > 0) {
					AudioCheckPlayer.setSpeed(item.playbackSpeed);
				}
				AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId: item.fileId } })
					.then((r) => {
						AudioCheckPlayer.playQueue([r.track], 0, positionMs, false);
					})
					.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
			}

			function paintRestoring() {
				idleMode = 'loading';
				body.textContent = '';
				const box = C.el('div', { className: 'ac-now-playing__loading' });
				box.appendChild(C.el('div', {
					className: 'ac-now-playing__loading-inner',
					attrs: { role: 'status', 'aria-live': 'polite' },
				}, [
					C.el('span', { className: 'ac-skeleton ac-skeleton--title' }),
					C.el('span', { className: 'ac-skeleton ac-skeleton--card' }),
					C.el('p', { className: 'ac-field__hint', text: t('audiocheck', 'Loading playback…') }),
				]));
				body.appendChild(box);
			}

			function paintContinueSection(items) {
				idleMode = 'resume';
				body.textContent = '';
				const section = C.el('section', {
					className: 'ac-section ac-now-resume',
					attrs: { 'aria-labelledby': 'ac-now-resume-heading' },
				});
				section.appendChild(C.el('h2', {
					id: 'ac-now-resume-heading',
					className: 'ac-section__title',
					text: t('audiocheck', 'Resume listening'),
				}));
				section.appendChild(C.el('p', {
					className: 'ac-field__hint ac-now-resume__intro',
					text: t('audiocheck', 'Pick up where you left off. Tap a title to load it, then press Play.'),
				}));
				const grid = C.el('div', { className: 'ac-grid ac-now-resume__grid' });
				items.slice(0, 6).forEach((item) => {
					grid.appendChild(C.mediaCard({
						fileId: item.fileId,
						title: item.title,
						artist: item.artist,
						browserPlayable: item.browserPlayable,
						progressPercent: item.durationMs > 0
							? Math.min(100, Math.round((item.positionMs / item.durationMs) * 100))
							: 0,
						finished: !!item.finished,
					}, () => playContinueItem(item)));
				});
				section.appendChild(grid);
				body.appendChild(section);
				const actions = C.el('div', {
					className: 'ac-toolbar ac-toolbar--compact ac-now-resume__actions',
					attrs: { 'aria-label': t('audiocheck', 'More actions') },
				});
				actions.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn',
					text: t('audiocheck', 'Browse'),
					onClick: () => AudioCheckRouter.navigate('browse', {}, true),
				}));
				actions.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--text',
					text: t('audiocheck', 'Go to Home'),
					onClick: () => AudioCheckRouter.navigate('home', {}, true),
				}));
				body.appendChild(actions);
			}

			function paintTrulyEmpty() {
				idleMode = 'empty';
				body.textContent = '';
				body.appendChild(C.emptyState(
					t('audiocheck', 'Nothing playing'),
					t('audiocheck', 'Choose audio from Home or Browse to start listening.'),
					{
						icon: 'music',
						ctaLabel: t('audiocheck', 'Browse'),
						onCta: () => AudioCheckRouter.navigate('browse', {}, true),
					},
				));
			}

			function paintNoTrackState() {
				if (AudioCheckPlayer.isRestoring && AudioCheckPlayer.isRestoring()) {
					paintRestoring();
					return;
				}
				paintRestoring();
				AudioCheckApi.get('/apps/audiocheck/api/progress').then((data) => {
					if (AudioCheckPlayer.getCurrentTrack()) return;
					const cont = (data.progress && data.progress.continue) || [];
					if (cont.length) {
						paintContinueSection(cont);
					} else {
						paintTrulyEmpty();
					}
				}).catch(() => {
					if (!AudioCheckPlayer.getCurrentTrack()) paintTrulyEmpty();
				});
			}

			function queueSignature() {
				const queue = AudioCheckPlayer.getQueue();
				const cur = AudioCheckPlayer.getCurrentIndex();
				const a = document.getElementById('ac-audio');
				const dur = a && cur >= 0 && a.duration && Number.isFinite(a.duration)
					? Math.floor(a.duration * 1000)
					: 0;
				const playing = !!(a && !a.paused);
				return cur + ':' + (playing ? '1' : '0') + ':' + dur + ':' + queue.map((tr) => String(tr.fileId) + (tr.unavailable ? 'u' : '')).join(',');
			}

			function trackForQueueRow(qTrack, index, cur) {
				if (index !== cur) return qTrack;
				const a = document.getElementById('ac-audio');
				if (!a || !a.duration || !Number.isFinite(a.duration)) return qTrack;
				return Object.assign({}, qTrack, { durationMs: Math.floor(a.duration * 1000) });
			}

			function paintSeek() {
				if (seekDragging) return;
				const a = document.getElementById('ac-audio');
				if (!a || !seekInput) return;
				if (a.duration && Number.isFinite(a.duration)) {
					seekInput.max = String(Math.floor(a.duration * 1000));
					seekInput.value = String(Math.floor(a.currentTime * 1000));
					if (posEl) posEl.textContent = AudioCheckTime.formatMs(a.currentTime * 1000);
					if (durEl) durEl.textContent = AudioCheckTime.formatMs(a.duration * 1000);
					seekInput.setAttribute('aria-valuetext',
						AudioCheckTime.formatMs(a.currentTime * 1000) + ' ' + t('audiocheck', 'of') + ' ' + AudioCheckTime.formatMs(a.duration * 1000));
				}
			}

			function paintTransport() {
				const a = document.getElementById('ac-audio');
				const playing = !!(a && !a.paused);
				if (playBtn) {
					playBtn.setAttribute('aria-label', playing ? t('audiocheck', 'Pause') : t('audiocheck', 'Play'));
					playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
					if (window.AudioCheckIcons) {
						AudioCheckIcons.mount(playBtn, playing ? 'pause' : 'play');
					}
				}
				const prevBtn = document.getElementById('ac-now-prev');
				const nextBtn = document.getElementById('ac-now-next');
				if (prevBtn) prevBtn.disabled = !AudioCheckPlayer.canGoPrev();
				if (nextBtn) nextBtn.disabled = !AudioCheckPlayer.canGoNext();
			}

			function setNowActionLabel(btn, label) {
				const labelEl = btn && btn.querySelector('.ac-btn__label');
				if (labelEl) labelEl.textContent = label;
			}

			function paintPlaybackActions(track) {
				if (!trackActions) return;
				trackActions.textContent = '';
				if (!track) return;
				const favLabel = track.favorite ? t('audiocheck', 'Unfavorite') : t('audiocheck', 'Favorite');
				const favBtn = nowActionBtn(
					favLabel,
					track.favorite ? 'heart-filled' : 'heart',
					() => {
						const fileId = AudioCheckApi.validFileId(track.fileId);
						if (!fileId) return;
						const next = !track.favorite;
						favBtn.disabled = true;
						AudioCheckApi.put('/apps/audiocheck/api/tracks/{fileId}/favorite', { favorite: next }, { params: { fileId } })
							.then(() => {
								track.favorite = next;
								AudioCheckMessaging.toast(next
									? t('audiocheck', 'Added to Favorites.')
									: t('audiocheck', 'Removed from Favorites.'));
								paintNow(true);
							}).catch((e) => {
								AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
								favBtn.disabled = false;
							});
					},
					{
						variant: 'favorite',
						active: !!track.favorite,
						pressed: !!track.favorite,
					},
				);
				const listenedLabel = track.listened ? t('audiocheck', 'Mark as not listened') : t('audiocheck', 'Mark as listened');
				const listenedBtn = nowActionBtn(
					listenedLabel,
					track.listened ? 'circle-check' : 'circle',
					() => {
						const fileId = AudioCheckApi.validFileId(track.fileId);
						if (!fileId) return;
						const next = !track.listened;
						listenedBtn.disabled = true;
						AudioCheckApi.put('/apps/audiocheck/api/tracks/{fileId}/listened', { listened: next }, { params: { fileId } })
							.then((r) => {
								track.listened = !!(r.progress && r.progress.listened);
								track.finished = !!(r.progress && r.progress.finished);
								if (window.AudioCheckTrackListUi) {
									AudioCheckTrackListUi.syncListenedState(track);
								}
								AudioCheckMessaging.toast(next
									? t('audiocheck', 'Marked as listened.')
									: t('audiocheck', 'Marked as not listened.'));
								paintNow(true);
							}).catch((e) => {
								AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error');
								listenedBtn.disabled = false;
							});
					},
					{
						variant: 'secondary',
						active: !!track.listened,
						pressed: !!track.listened,
					},
				);
				const resetBtn = nowActionBtn(t('audiocheck', 'Reset progress'), 'rotate-ccw', () => {
					const fileId = AudioCheckApi.validFileId(track.fileId);
					if (!fileId) return;
					resetBtn.disabled = true;
					AudioCheckApi.del('/apps/audiocheck/api/progress/{fileId}', null, { params: { fileId } })
						.then(() => AudioCheckMessaging.toast(t('audiocheck', 'Progress reset.')))
						.catch((e) => AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error'))
						.finally(() => { resetBtn.disabled = false; });
				});
				trackActions.appendChild(favBtn);
				trackActions.appendChild(listenedBtn);
				trackActions.appendChild(resetBtn);
			}

			function paintChapters() {
				const track = AudioCheckPlayer.getCurrentTrack();
				if (!track || chaptersSection.hidden) return;
				const chapters = track.chapters || [];
				const a = document.getElementById('ac-audio');
				const ms = a ? Math.floor(a.currentTime * 1000) : 0;
				const activeChapter = AudioCheckPlayer.chapterAt(ms, chapters);
				chaptersUl.querySelectorAll('.ac-chapter-list__btn').forEach((btn, i) => {
					if (i === activeChapter) btn.setAttribute('aria-current', 'true');
					else btn.removeAttribute('aria-current');
				});
			}

			function paintNow(force) {
				const track = AudioCheckPlayer.getCurrentTrack();
				const fileId = track ? (track.fileId || 0) : 0;
				const isEmpty = !track;

				const listenedKey = track ? ((track.listened ? '1' : '0') + (track.finished ? '1' : '0')) : '';

				if (!force && isEmpty === renderedEmpty && fileId === renderedFileId && listenedKey === renderedListenedKey) {
					if (!isEmpty) {
						paintSeek();
						paintTransport();
						paintChapters();
					}
					return;
				}
				renderedEmpty = isEmpty;
				renderedFileId = fileId;
				renderedListenedKey = listenedKey;
				lastQueueSig = '';
				playBtn = null;
				seekInput = null;
				posEl = null;
				durEl = null;

				body.textContent = '';
				idleMode = '';
				body.classList.remove('ac-now-playing__body--active');

				if (!track) {
					renderedEmpty = true;
					renderedFileId = 0;
					paintNoTrackState();
					return;
				}

				renderedEmpty = false;
				body.classList.add('ac-now-playing__body--active');

				const hero = C.el('article', {
					className: 'ac-card ac-now-card ac-now-card--playing',
					id: 'ac-now-card',
					attrs: { 'aria-labelledby': 'ac-now-title' },
				});
				const coverWrap = C.el('div', { className: 'ac-now-card__cover-wrap' });
				const coverUrl = AudioCheckApi.coverUrl(track.fileId);
				if (coverUrl) {
					coverWrap.appendChild(C.el('img', {
						className: 'ac-now-card__cover',
						src: coverUrl,
						alt: '',
						width: '200',
						height: '200',
					}));
				} else {
					coverWrap.appendChild(C.el('div', {
						className: 'ac-now-card__cover ac-card__cover--placeholder',
						attrs: { 'aria-hidden': 'true' },
					}));
				}
				hero.appendChild(coverWrap);

				const cardBody = C.el('div', { className: 'ac-now-card__body' });
				const meta = C.el('div', { className: 'ac-now-card__meta' });
				meta.appendChild(C.el('h2', {
					id: 'ac-now-title',
					className: 'ac-now-card__title',
					text: track.title || track.fileName || '',
				}));
				if (track.artist) {
					meta.appendChild(C.el('p', { className: 'ac-now-card__artist', text: track.artist }));
				}
				if (track.album) {
					meta.appendChild(C.el('p', { className: 'ac-now-card__album', text: track.album }));
				}
				if (track.browserPlayable === false) {
					meta.appendChild(C.browserCompatNote());
				}
				if (track.listened || track.finished) {
					meta.appendChild(C.el('p', {
						className: 'ac-badge ac-badge--ok ac-now-card__listened-badge',
						attrs: { role: 'status' },
						text: t('audiocheck', 'Listened'),
					}));
				}
				cardBody.appendChild(meta);

				const player = C.el('div', { className: 'ac-now-card__player' });
				const transport = C.el('div', {
					className: 'ac-now-transport',
					attrs: { role: 'group' },
				});
				const prevBtn = transportBtn(t('audiocheck', 'Previous'), 'previous', false, () => AudioCheckPlayer.prev());
				prevBtn.id = 'ac-now-prev';
				playBtn = transportBtn(t('audiocheck', 'Play'), 'play', true, () => AudioCheckPlayer.toggle());
				playBtn.id = 'ac-now-play';
				const nextBtn = transportBtn(t('audiocheck', 'Next'), 'next', false, () => AudioCheckPlayer.next());
				nextBtn.id = 'ac-now-next';
				transport.appendChild(prevBtn);
				transport.appendChild(playBtn);
				transport.appendChild(nextBtn);
				player.appendChild(transport);

				const seekWrap = C.el('div', { className: 'ac-now-seek' });
				seekInput = C.el('input', {
					type: 'range',
					id: 'ac-now-seek',
					className: 'ac-seek',
					attrs: { min: '0', max: '1000', value: '0', 'aria-label': t('audiocheck', 'Seek') },
				});
				seekInput.addEventListener('pointerdown', () => { seekDragging = true; });
				seekInput.addEventListener('pointerup', () => { seekDragging = false; });
				seekInput.addEventListener('pointercancel', () => { seekDragging = false; });
				seekInput.addEventListener('input', (e) => {
					const a = document.getElementById('ac-audio');
					const ms = parseInt(e.target.value, 10);
					if (a && a.duration) a.currentTime = ms / 1000;
				});
				const timeRow = C.el('div', { className: 'ac-now-time' });
				posEl = C.el('span', { className: 'ac-now-time__pos', text: '0:00' });
				durEl = C.el('span', { className: 'ac-now-time__dur', text: '0:00' });
				timeRow.appendChild(posEl);
				timeRow.appendChild(durEl);
				seekWrap.appendChild(seekInput);
				seekWrap.appendChild(timeRow);
				player.appendChild(seekWrap);
				cardBody.appendChild(player);

				hero.appendChild(cardBody);
				hero.appendChild(settingsSection);

				const panels = C.el('div', { className: 'ac-now-playing__panels' });
				body.appendChild(hero);
				panels.appendChild(queueSection);
				panels.appendChild(chaptersSection);
				body.appendChild(panels);
				queueSection.hidden = false;

				chaptersUl.textContent = '';
				const chapters = track.chapters || [];
				const a = document.getElementById('ac-audio');
				const ms = a ? Math.floor(a.currentTime * 1000) : 0;
				const activeChapter = AudioCheckPlayer.chapterAt(ms, chapters);
				const showChapters = chapters.length > 0 || track.hasChapters;
				chaptersSection.hidden = !showChapters;
				if (chapters.length) {
					chapters.forEach((ch, i) => {
						const li = C.el('li', { className: 'ac-chapter-list__item' });
						li.appendChild(C.el('button', {
							type: 'button',
							className: 'ac-btn ac-btn--text ac-chapter-list__btn',
							text: (ch.title || t('audiocheck', 'Chapter {n}', { n: String(i + 1) })) + ' — ' + AudioCheckTime.formatMs(ch.start_ms || 0),
							attrs: i === activeChapter ? { 'aria-current': 'true' } : {},
							onClick: () => AudioCheckPlayer.seekToMs(ch.start_ms || 0),
						}));
						chaptersUl.appendChild(li);
					});
				} else if (track.hasChapters) {
					chaptersUl.appendChild(C.el('li', {
						className: 'ac-chapter-list__loading',
						text: t('audiocheck', 'Loading chapters…'),
					}));
				}

				paintPlaybackActions(track);
				paintSeek();
				paintTransport();
			}

			function paintQueue() {
				const track = AudioCheckPlayer.getCurrentTrack();
				if (!track || !queueUl.parentElement) return;
				const sig = queueSignature();
				if (sig === lastQueueSig) return;
				lastQueueSig = sig;
				const queue = AudioCheckPlayer.getQueue();
				const cur = AudioCheckPlayer.getCurrentIndex();
				const a = document.getElementById('ac-audio');
				const playing = !!(a && !a.paused);
				const metaEl = document.getElementById('ac-queue-meta');
				if (metaEl) {
					if (queue.length === 1) {
						metaEl.textContent = t('audiocheck', '1 track in queue');
					} else if (queue.length) {
						metaEl.textContent = t('audiocheck', '{count} tracks in queue', { count: String(queue.length) });
					} else {
						metaEl.textContent = '';
					}
				}
				if (queueClear) queueClear.hidden = queue.length === 0;
				queueUl.textContent = '';
				if (!queue.length) {
					queueUl.appendChild(C.el('li', {
						className: 'ac-track-list__empty',
						text: t('audiocheck', 'Queue is empty.'),
					}));
					return;
				}
				queue.forEach((qTrack, i) => {
					const rowTrack = trackForQueueRow(qTrack, i, cur);
					const rowOpts = window.AudioCheckTrackListUi
						? AudioCheckTrackListUi.trackRowOptions(rowTrack, {
							rowVariant: 'queue',
							active: i === cur,
							playing: i === cur && playing,
							removeLabel: t('audiocheck', 'Remove from queue'),
							onRemove: () => AudioCheckPlayer.removeAt(i),
						})
						: {
							rowVariant: 'queue',
							active: i === cur,
							playing: i === cur && playing,
							removeLabel: t('audiocheck', 'Remove from queue'),
							onRemove: () => AudioCheckPlayer.removeAt(i),
						};
					queueUl.appendChild(C.trackRow(rowTrack, () => AudioCheckPlayer.playQueue(queue, i), rowOpts));
				});
			}

			function paintControls() {
				const shuffleOn = AudioCheckPlayer.getShuffle();
				const repeatMode = AudioCheckPlayer.getRepeatMode();
				setNowActionLabel(shuffleBtn, shuffleOn ? t('audiocheck', 'Shuffle on') : t('audiocheck', 'Shuffle off'));
				shuffleBtn.setAttribute('aria-pressed', shuffleOn ? 'true' : 'false');
				shuffleBtn.classList.toggle('ac-now-action--active', shuffleOn);
				setNowActionLabel(repeatBtn, repeatLabel(repeatMode));
				repeatBtn.setAttribute('aria-pressed', repeatMode !== AudioCheckConstants.REPEAT_OFF ? 'true' : 'false');
				repeatBtn.classList.toggle('ac-now-action--active', repeatMode !== AudioCheckConstants.REPEAT_OFF);
				const curSpeed = AudioCheckConstants.SPEED_PRESETS.includes(
					Math.round((document.getElementById('ac-audio')?.playbackRate || 1) * 100)
				) ? Math.round((document.getElementById('ac-audio')?.playbackRate || 1) * 100) : 100;
				speed.value = String(curSpeed);
			}

			const unsub = AudioCheckPlayer.subscribe(() => {
				paintNow();
				paintQueue();
				paintControls();
			});

			frag.appendChild(C.pageHeader(
				t('audiocheck', 'Now playing'),
				t('audiocheck', 'Player, queue, and chapters.'),
			));
			frag.appendChild(body);

			paintNow();
			paintQueue();
			paintControls();

			if (typeof AudioCheckPlayer.whenReady === 'function') {
				AudioCheckPlayer.whenReady().then(() => {
					paintNow(true);
					paintQueue();
					paintControls();
				});
			}

			const onListenedChanged = () => {
				paintNow(true);
				paintQueue();
			};
			document.addEventListener('audiocheck-listened-changed', onListenedChanged);

			const observer = new MutationObserver(() => {
				if (!document.body.contains(body)) {
					unsub();
					document.removeEventListener('audiocheck-listened-changed', onListenedChanged);
					observer.disconnect();
				}
			});
			setTimeout(() => {
				if (body.parentElement) observer.observe(document.body, { childList: true, subtree: true });
			}, 0);

			return frag;
		},
	});
})();
