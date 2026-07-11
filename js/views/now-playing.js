(function () {
	'use strict';
	const C = AudioCheckComponents;

	function repeatShortLabel(mode) {
		if (mode === AudioCheckConstants.REPEAT_ONE) return t('audiocheck', 'One');
		if (mode === AudioCheckConstants.REPEAT_ALL) return t('audiocheck', 'All');
		return t('audiocheck', 'Off');
	}

	function repeatAriaLabel(mode) {
		if (mode === AudioCheckConstants.REPEAT_ONE) return t('audiocheck', 'Repeat one');
		if (mode === AudioCheckConstants.REPEAT_ALL) return t('audiocheck', 'Repeat all');
		return t('audiocheck', 'Repeat off');
	}

	function sectionLabel(text, id) {
		return C.el('h2', {
			className: 'ac-now-section__label',
			text,
			attrs: id ? { id } : {},
		});
	}

	function playbackOptionRow(opts) {
		const row = C.el('button', {
			type: 'button',
			className: 'ac-playback-option' + (opts.active ? ' ac-playback-option--active' : ''),
			disabled: !!opts.disabled,
			attrs: {
				'aria-label': opts.ariaLabel || opts.label,
				'aria-pressed': opts.active ? 'true' : 'false',
			},
			onClick: opts.onClick,
		});
		if (opts.icon && window.AudioCheckIcons) {
			const icon = C.el('span', { className: 'ac-playback-option__icon', attrs: { 'aria-hidden': 'true' } });
			icon.appendChild(AudioCheckIcons.createSvg(opts.icon));
			row.appendChild(icon);
		}
		row.appendChild(C.el('span', { className: 'ac-playback-option__label', text: opts.label }));
		row.appendChild(C.el('span', { className: 'ac-playback-option__value', text: opts.value }));
		return row;
	}

	function transportBtn(label, iconName, primary, onClick) {
		const btn = C.el('button', {
			type: 'button',
			className: 'ac-btn ac-transport-btn' + (primary ? ' ac-transport-btn--primary ac-transport-btn--hero' : ''),
			attrs: { 'aria-label': label },
			onClick,
		});
		if (window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg(iconName));
		}
		return btn;
	}

	function trackActionBtn(label, iconName, onClick, options) {
		const opts = options || {};
		const btn = C.el('button', {
			type: 'button',
			className: 'ac-btn ac-now-track-action' + (opts.active ? ' ac-now-track-action--active' : ''),
			attrs: {
				'aria-label': label,
				'aria-pressed': opts.active ? 'true' : 'false',
			},
			disabled: !!opts.disabled,
			onClick,
		});
		if (iconName && window.AudioCheckIcons) {
			btn.appendChild(AudioCheckIcons.createSvg(iconName));
		}
		btn.appendChild(C.el('span', { className: 'ac-now-track-action__text', text: label }));
		return btn;
	}

	function modeBanner(title, hint, iconName) {
		const banner = C.el('div', {
			className: 'ac-now-mode-banner',
			attrs: { role: 'status' },
		});
		if (iconName && window.AudioCheckIcons) {
			const icon = C.el('span', { className: 'ac-now-mode-banner__icon', attrs: { 'aria-hidden': 'true' } });
			icon.appendChild(AudioCheckIcons.createSvg(iconName));
			banner.appendChild(icon);
		}
		const text = C.el('div', { className: 'ac-now-mode-banner__text' });
		text.appendChild(C.el('p', { className: 'ac-now-mode-banner__title', text: title }));
		if (hint) {
			text.appendChild(C.el('p', { className: 'ac-now-mode-banner__hint', text: hint }));
		}
		banner.appendChild(text);
		return banner;
	}

	AudioCheckRouter.register('now-playing', {
		render() {
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-now-playing__body' });

			let shuffleRow = null;
			let repeatRow = null;
			let startModeRow = null;
			let speed = null;
			let sleepBanner = null;
			let sleepStatus = null;
			let sleepCancel = null;
			let chapterEndBtn = null;
			let sleepCustomInput = null;
			let queueSection = null;
			let queueUl = null;
			let queueMeta = null;
			let queueClear = null;
			let chaptersSection = null;
			let chaptersUl = null;
			let optionsSection = null;
			let trackSection = null;
			let statusBadge = null;
			let statusText = null;
			let statusMeta = null;
			let modeBannersEl = null;
			let trackActionsEl = null;
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

			function buildOptionsSection() {
				const section = C.el('section', {
					className: 'ac-now-section ac-now-section--options',
					attrs: { 'aria-labelledby': 'ac-now-options-heading' },
				});
				section.appendChild(sectionLabel(t('audiocheck', 'Playback options'), 'ac-now-options-heading'));

				sleepBanner = C.el('div', {
					id: 'ac-sleep-timer-banner',
					className: 'ac-sleep-timer-banner ac-now-sleep-banner',
					attrs: { hidden: true, role: 'status' },
				});
				section.appendChild(sleepBanner);

				const queueModeWrap = C.el('div', { className: 'ac-now-subsection' });
				queueModeWrap.appendChild(C.el('h3', {
					className: 'ac-now-subsection__label',
					text: t('audiocheck', 'Queue mode'),
				}));
				const optionGroup = C.el('div', {
					className: 'ac-playback-option-group',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Queue mode') },
				});

				shuffleRow = playbackOptionRow({
					icon: 'shuffle',
					label: t('audiocheck', 'Shuffle'),
					value: t('audiocheck', 'Off'),
					ariaLabel: t('audiocheck', 'Shuffle off'),
					onClick: () => AudioCheckPlayer.setShuffle(!AudioCheckPlayer.getShuffle()),
				});
				shuffleRow.id = 'ac-shuffle-row';

				repeatRow = playbackOptionRow({
					icon: 'repeat',
					label: t('audiocheck', 'Repeat'),
					value: t('audiocheck', 'Off'),
					ariaLabel: t('audiocheck', 'Repeat off'),
					onClick: () => AudioCheckPlayer.cycleRepeat(),
				});
				repeatRow.id = 'ac-repeat-row';

				startModeRow = playbackOptionRow({
					icon: 'playlist',
					label: t('audiocheck', 'Start mode'),
					value: t('audiocheck', 'From the beginning'),
					ariaLabel: t('audiocheck', 'From the beginning'),
					onClick: () => {
						const policy = AudioCheckPlayer.getQueuePlaybackPolicy();
						const fromStart = policy.mode === 'sequential' && policy.resumeAnchorIndex === null;
						if (fromStart) {
							AudioCheckPlayer.setQueuePlaybackPolicy({ mode: 'resume', resumeAnchorIndex: null });
							AudioCheckMessaging.toast(t('audiocheck', 'Continue where you left off on each track'));
						} else {
							AudioCheckPlayer.setQueuePlaybackPolicy({ mode: 'sequential', resumeAnchorIndex: null });
							AudioCheckMessaging.toast(t('audiocheck', 'Every file will start from the beginning'));
						}
						paintControls();
						paintNow(true);
					},
				});
				startModeRow.id = 'ac-start-mode-row';

				optionGroup.appendChild(shuffleRow);
				optionGroup.appendChild(repeatRow);
				optionGroup.appendChild(startModeRow);
				queueModeWrap.appendChild(optionGroup);
				section.appendChild(queueModeWrap);

				const adjustmentsWrap = C.el('div', { className: 'ac-now-subsection' });
				adjustmentsWrap.appendChild(C.el('h3', {
					className: 'ac-now-subsection__label',
					text: t('audiocheck', 'Adjustments'),
				}));
				const adjustments = C.el('div', { className: 'ac-now-adjustments' });

				speed = C.el('select', {
					id: 'ac-speed-select',
					className: 'ac-input ac-now-field__control',
				});
				AudioCheckConstants.SPEED_PRESETS.forEach((s) => {
					const o = document.createElement('option');
					o.value = String(s);
					o.textContent = (s / 100).toFixed(2) + '×';
					speed.appendChild(o);
				});
				speed.addEventListener('change', () => AudioCheckPlayer.setSpeed(parseInt(speed.value, 10)));
				adjustments.appendChild(C.el('label', {
					className: 'ac-now-field',
					attrs: { for: 'ac-speed-select' },
				}, [
					C.el('span', { className: 'ac-now-field__label', text: t('audiocheck', 'Speed') }),
					speed,
				]));

				const volumeField = C.el('div', { className: 'ac-now-field ac-now-field--volume' });
				volumeField.appendChild(C.el('span', { className: 'ac-now-field__label', text: t('audiocheck', 'Volume') }));
				volumeField.appendChild(C.volumeControl({ idPrefix: 'ac-now' }));
				adjustments.appendChild(volumeField);

				const sleepDetails = C.el('details', { className: 'ac-now-sleep-details' });
				sleepDetails.appendChild(C.el('summary', {
					className: 'ac-now-field ac-now-field--summary',
					text: t('audiocheck', 'Sleep timer'),
				}));
				const sleepBody = C.el('div', { className: 'ac-now-sleep-details__body' });
				sleepStatus = C.el('p', {
					id: 'ac-sleep-timer-status',
					className: 'ac-field__hint',
					attrs: { role: 'status', 'aria-live': 'polite' },
				});
				const sleepActions = C.el('div', { className: 'ac-sleep-timer__actions' });
				const sleepPresets = C.el('div', {
					className: 'ac-sleep-timer__presets',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Stop after') },
				});
				AudioCheckSleepTimer.PRESETS_MIN.forEach((minutes) => {
					sleepPresets.appendChild(C.el('button', {
						type: 'button',
						className: 'ac-btn ac-btn--compact',
						text: t('audiocheck', '{minutes} min', { minutes: String(minutes) }),
						attrs: { 'aria-label': t('audiocheck', 'Sleep timer: {minutes} minutes', { minutes: String(minutes) }) },
						onClick: () => {
							if (AudioCheckSleepTimer.startDuration(minutes)) {
								AudioCheckMessaging.toast(t('audiocheck', 'Sleep timer set for {time}', {
									time: t('audiocheck', '{minutes} minutes', { minutes: String(minutes) }),
								}));
								paintSleepTimer();
							}
						},
					}));
				});
				const sleepWhen = C.el('div', {
					className: 'ac-sleep-timer__when',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Stop when') },
				});
				sleepWhen.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--compact',
					text: t('audiocheck', 'End of track'),
					onClick: () => {
						AudioCheckSleepTimer.startTrackEnd();
						AudioCheckMessaging.toast(t('audiocheck', 'Sleep timer will stop at end of track'));
						paintSleepTimer();
					},
				}));
				chapterEndBtn = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--compact',
					text: t('audiocheck', 'End of chapter'),
					attrs: { hidden: true },
					onClick: () => {
						const track = AudioCheckPlayer.getCurrentTrack();
						const a = document.getElementById('ac-audio');
						if (!track || !a || !track.chapters || !track.chapters.length) return;
						const ms = Math.floor(a.currentTime * 1000);
						const chIdx = AudioCheckPlayer.chapterAt(ms, track.chapters);
						const nextCh = track.chapters[chIdx + 1];
						const endMs = nextCh ? nextCh.start_ms : (track.durationMs || Math.floor(a.duration * 1000));
						if (AudioCheckSleepTimer.startChapterEnd(track.fileId, endMs)) {
							AudioCheckMessaging.toast(t('audiocheck', 'Sleep timer will stop at end of chapter'));
							paintSleepTimer();
						}
					},
				});
				sleepWhen.appendChild(chapterEndBtn);
				sleepCancel = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--text',
					id: 'ac-sleep-timer-cancel',
					text: t('audiocheck', 'Cancel timer'),
					attrs: { hidden: true },
					onClick: () => {
						AudioCheckSleepTimer.cancel();
						AudioCheckMessaging.toast(t('audiocheck', 'Sleep timer canceled'));
						paintSleepTimer();
					},
				});
				const sleepCustomRow = C.el('div', { className: 'ac-sleep-timer__custom' });
				sleepCustomInput = C.el('input', {
					type: 'number',
					className: 'ac-input ac-sleep-timer__custom-input',
					attrs: {
						min: String(AudioCheckSleepTimer.CUSTOM_MIN),
						max: String(AudioCheckSleepTimer.CUSTOM_MAX),
						placeholder: t('audiocheck', 'Minutes'),
						'aria-label': t('audiocheck', 'Custom sleep timer minutes'),
					},
				});
				sleepCustomRow.appendChild(sleepCustomInput);
				sleepCustomRow.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--compact',
					text: t('audiocheck', 'Set'),
					onClick: () => {
						const minutes = AudioCheckSleepTimer.parseCustomMinutes(sleepCustomInput.value);
						if (minutes == null) {
							AudioCheckMessaging.toast(t('audiocheck', 'Enter {min}–{max} minutes', {
								min: String(AudioCheckSleepTimer.CUSTOM_MIN),
								max: String(AudioCheckSleepTimer.CUSTOM_MAX),
							}), 'warning');
							return;
						}
						AudioCheckSleepTimer.startDuration(minutes);
						AudioCheckMessaging.toast(t('audiocheck', 'Sleep timer set for {time}', {
							time: t('audiocheck', '{minutes} minutes', { minutes: String(minutes) }),
						}));
						paintSleepTimer();
					},
				}));
				sleepActions.appendChild(sleepPresets);
				sleepActions.appendChild(sleepWhen);
				sleepActions.appendChild(sleepCustomRow);
				sleepActions.appendChild(sleepCancel);
				sleepBody.appendChild(sleepStatus);
				sleepBody.appendChild(sleepActions);
				sleepBody.appendChild(C.el('p', {
					className: 'ac-field__hint',
					text: t('audiocheck', 'Pauses playback when the timer ends. Works while this tab is open.'),
				}));
				sleepDetails.appendChild(sleepBody);
				adjustments.appendChild(sleepDetails);
				adjustmentsWrap.appendChild(adjustments);
				section.appendChild(adjustmentsWrap);
				return section;
			}

			function buildQueueSection() {
				const section = C.el('section', {
					className: 'ac-now-section ac-now-section--queue',
					id: 'ac-queue-section',
					attrs: { 'aria-labelledby': 'ac-queue-heading' },
				});
				const head = C.el('div', { className: 'ac-now-queue__head' });
				head.appendChild(C.el('h2', {
					id: 'ac-queue-heading',
					className: 'ac-now-queue__title',
					text: t('audiocheck', 'Queue'),
				}));
				queueMeta = C.el('p', {
					id: 'ac-queue-meta',
					className: 'ac-now-queue__meta',
					attrs: { 'aria-live': 'polite' },
				});
				head.appendChild(queueMeta);
				queueClear = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--danger ac-now-queue__clear',
					text: t('audiocheck', 'Clear queue'),
					onClick: () => {
						C.openModal({
							title: t('audiocheck', 'Clear queue?'),
							primaryLabel: t('audiocheck', 'Clear queue'),
							cancelLabel: t('audiocheck', 'Cancel'),
							render() {
								return C.el('p', {
									className: 'ac-field__hint',
									text: t('audiocheck', 'Remove all tracks from the queue. Playback will stop.'),
								});
							},
							onSubmit: () => {
								AudioCheckPlayer.clearQueue();
								AudioCheckMessaging.toast(t('audiocheck', 'Queue cleared.'));
								return true;
							},
						});
					},
				});
				head.appendChild(queueClear);
				section.appendChild(head);
				section.appendChild(C.el('p', {
					className: 'ac-now-queue__hint',
					text: t('audiocheck', 'Tap a track to jump to it. Use the arrows to reorder.'),
				}));
				queueUl = C.el('ul', { className: 'ac-track-list ac-now-queue', id: 'ac-queue-list' });
				section.appendChild(queueUl);
				return section;
			}

			function buildChaptersSection() {
				const section = C.el('section', {
					className: 'ac-now-section ac-now-section--chapters',
					id: 'ac-chapters-section',
					attrs: { hidden: true, 'aria-labelledby': 'ac-chapters-heading' },
				});
				section.appendChild(sectionLabel(t('audiocheck', 'Chapters'), 'ac-chapters-heading'));
				chaptersUl = C.el('ul', { className: 'ac-chapter-list', id: 'ac-chapter-list' });
				section.appendChild(chaptersUl);
				return section;
			}

			optionsSection = buildOptionsSection();
			queueSection = buildQueueSection();
			chaptersSection = buildChaptersSection();

			function paintSleepTimer() {
				const ST = window.AudioCheckSleepTimer;
				if (!ST || !sleepStatus) return;
				const state = ST.getState();
				const active = state.active;
				if (sleepBanner) {
					sleepBanner.hidden = !active;
					if (active) sleepBanner.textContent = ST.activeLabel(state);
				}
				if (sleepCancel) sleepCancel.hidden = !active;
				sleepStatus.textContent = active ? ST.activeLabel(state) : t('audiocheck', 'Sleep timer off');
				const track = AudioCheckPlayer.getCurrentTrack();
				const hasChapters = !!(track && track.chapters && track.chapters.length > 1);
				if (chapterEndBtn) chapterEndBtn.hidden = !hasChapters;
			}

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
				body.classList.remove('ac-now-playing__body--active');
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
				body.classList.remove('ac-now-playing__body--active');
				const section = C.el('section', {
					className: 'ac-now-section ac-now-resume',
					attrs: { 'aria-labelledby': 'ac-now-resume-heading' },
				});
				section.appendChild(sectionLabel(t('audiocheck', 'Resume listening'), 'ac-now-resume-heading'));
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
				body.classList.remove('ac-now-playing__body--active');
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
				AudioCheckApi.get('/apps/audiocheck/api/progress').then((data) => {
					if (AudioCheckPlayer.getCurrentTrack()) return;
					const cont = (data.progress && data.progress.continue) || [];
					if (cont.length) paintContinueSection(cont);
					else paintTrulyEmpty();
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
				const waiting = !!(a && a.readyState < 3 && !a.paused);
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
				if (statusText) {
					if (waiting) {
						statusText.textContent = t('audiocheck', 'Buffering');
					} else if (playing) {
						statusText.textContent = t('audiocheck', 'Playing');
					} else {
						statusText.textContent = t('audiocheck', 'Paused');
					}
				}
				if (statusBadge) {
					statusBadge.classList.toggle('ac-now-status--playing', playing && !waiting);
					statusBadge.classList.toggle('ac-now-status--paused', !playing && !waiting);
					statusBadge.classList.toggle('ac-now-status--buffering', waiting);
					const iconWrap = statusBadge.querySelector('.ac-now-status__icon');
					if (iconWrap && window.AudioCheckIcons) {
						AudioCheckIcons.mount(iconWrap, playing && !waiting ? 'play' : 'pause');
					}
				}
			}

			function paintStatusMeta() {
				if (!statusMeta) return;
				const queue = AudioCheckPlayer.getQueue();
				const cur = AudioCheckPlayer.getCurrentIndex();
				if (queue.length > 0 && cur >= 0) {
					statusMeta.textContent = t('audiocheck', '{index} of {total} in queue', {
						index: String(cur + 1),
						total: String(queue.length),
					});
				} else {
					statusMeta.textContent = '';
				}
			}

			function paintModeBanners(track) {
				if (!modeBannersEl) return;
				modeBannersEl.textContent = '';
				const policy = AudioCheckPlayer.getQueuePlaybackPolicy();
				const curIdx = AudioCheckPlayer.getCurrentIndex();
				const queueLen = AudioCheckPlayer.getQueue().length;
				const atResumeAnchor = policy.resumeAnchorIndex !== null && policy.resumeAnchorIndex === curIdx;
				const showFromStartBanner = queueLen > 1 && !atResumeAnchor && policy.mode === 'sequential';
				if (showFromStartBanner) {
					modeBannersEl.appendChild(modeBanner(
						t('audiocheck', 'Every file starts from the beginning'),
						t('audiocheck', 'New tracks in the queue begin at 0:00.'),
						'playlist',
					));
				} else if (atResumeAnchor) {
					modeBannersEl.appendChild(modeBanner(
						t('audiocheck', 'Resuming where you left off on this track'),
						t('audiocheck', 'This track continues at your saved position.'),
						'history',
					));
				}
			}

			function paintTrackActions(track) {
				if (!trackActionsEl || !track) return;
				trackActionsEl.textContent = '';
				const favLabel = track.favorite ? t('audiocheck', 'Unfavorite') : t('audiocheck', 'Favorite');
				const favBtn = trackActionBtn(
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
					{ active: !!track.favorite },
				);
				const listenedLabel = track.listened
					? t('audiocheck', 'Mark as not listened')
					: t('audiocheck', 'Mark as listened');
				const listenedBtn = trackActionBtn(
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
					{ active: !!track.listened },
				);
				trackActionsEl.appendChild(favBtn);
				trackActionsEl.appendChild(listenedBtn);
				trackActionsEl.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--text ac-now-reset-progress',
					text: t('audiocheck', 'Reset progress'),
					onClick: () => {
						const fileId = AudioCheckApi.validFileId(track.fileId);
						if (!fileId) return;
						AudioCheckApi.del('/apps/audiocheck/api/progress/{fileId}', null, { params: { fileId } })
							.then(() => AudioCheckMessaging.toast(t('audiocheck', 'Progress reset.')))
							.catch((e) => AudioCheckMessaging.toast(e.message || t('audiocheck', 'Request failed.'), 'error'));
					},
				}));
			}

			function paintChapters() {
				const track = AudioCheckPlayer.getCurrentTrack();
				if (!track || !chaptersSection || chaptersSection.hidden) return;
				const chapters = track.chapters || [];
				const a = document.getElementById('ac-audio');
				const ms = a ? Math.floor(a.currentTime * 1000) : 0;
				const activeChapter = AudioCheckPlayer.chapterAt(ms, chapters);
				chaptersUl.querySelectorAll('.ac-chapter-list__btn').forEach((btn, i) => {
					if (i === activeChapter) btn.setAttribute('aria-current', 'true');
					else btn.removeAttribute('aria-current');
				});
			}

			function buildTrackSection(track) {
				const section = C.el('section', {
					className: 'ac-now-section ac-now-section--track',
					attrs: { 'aria-labelledby': 'ac-now-track-heading' },
				});
				section.appendChild(sectionLabel(t('audiocheck', 'Current track'), 'ac-now-track-heading'));

				statusBadge = C.el('div', {
					className: 'ac-now-status',
					attrs: { role: 'status' },
				});
				if (window.AudioCheckIcons) {
					const icon = C.el('span', { className: 'ac-now-status__icon', attrs: { 'aria-hidden': 'true' } });
					icon.appendChild(AudioCheckIcons.createSvg('play'));
					statusBadge.appendChild(icon);
				}
				statusText = C.el('span', { className: 'ac-now-status__text', text: t('audiocheck', 'Paused') });
				statusMeta = C.el('span', { className: 'ac-now-status__meta' });
				statusBadge.appendChild(statusText);
				statusBadge.appendChild(statusMeta);
				section.appendChild(statusBadge);

				modeBannersEl = C.el('div', { className: 'ac-now-mode-banners' });
				section.appendChild(modeBannersEl);
				paintModeBanners(track);

				const coverWrap = C.el('div', { className: 'ac-now-card__cover-wrap' });
				const coverUrl = AudioCheckApi.coverUrl(track.fileId);
				if (coverUrl) {
					coverWrap.appendChild(C.el('img', {
						className: 'ac-now-card__cover',
						src: coverUrl,
						alt: '',
						width: '280',
						height: '280',
						attrs: { 'aria-hidden': 'true' },
					}));
				} else {
					coverWrap.appendChild(C.el('div', {
						className: 'ac-now-card__cover ac-card__cover--placeholder',
						attrs: { 'aria-hidden': 'true' },
					}));
				}
				section.appendChild(coverWrap);

				section.appendChild(C.el('h3', {
					id: 'ac-now-title',
					className: 'ac-now-card__title',
					text: track.title || track.fileName || '',
				}));

				const subtitleParts = [];
				if (track.artist) subtitleParts.push(track.artist);
				if (track.album) subtitleParts.push(track.album);
				if (subtitleParts.length) {
					section.appendChild(C.el('p', {
						className: 'ac-now-card__subtitle',
						text: subtitleParts.join(' — '),
					}));
				}
				if (track.browserPlayable === false) {
					section.appendChild(C.browserCompatNote());
				}
				if (track.listened || track.finished) {
					section.appendChild(C.el('p', {
						className: 'ac-badge ac-badge--ok',
						attrs: { role: 'status' },
						text: t('audiocheck', 'Listened'),
					}));
				}

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
					const posText = AudioCheckTime.formatMs(ms);
					if (posEl) posEl.textContent = posText;
					e.target.setAttribute('aria-valuetext', posText);
				});
				const timeRow = C.el('div', { className: 'ac-now-time' });
				posEl = C.el('span', { className: 'ac-now-time__pos', text: '0:00' });
				durEl = C.el('span', { className: 'ac-now-time__dur', text: '0:00' });
				timeRow.appendChild(posEl);
				timeRow.appendChild(durEl);
				seekWrap.appendChild(seekInput);
				seekWrap.appendChild(timeRow);
				section.appendChild(seekWrap);

				trackActionsEl = C.el('div', {
					className: 'ac-now-track-actions',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Track actions') },
				});
				paintTrackActions(track);
				section.appendChild(trackActionsEl);

				const transport = C.el('div', {
					className: 'ac-now-transport',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Playback controls') },
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
				section.appendChild(transport);
				return section;
			}

			function paintChaptersList(track) {
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
							text: (ch.title || t('audiocheck', 'Chapter {n}', { n: String(i + 1) }))
								+ ' — ' + AudioCheckTime.formatMs(ch.start_ms || 0),
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
						paintStatusMeta();
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
				statusBadge = null;
				statusText = null;
				statusMeta = null;
				modeBannersEl = null;
				trackActionsEl = null;

				body.textContent = '';
				idleMode = '';

				if (!track) {
					body.classList.remove('ac-now-playing__body--active');
					paintNoTrackState();
					return;
				}

				body.classList.add('ac-now-playing__body--active');
				const stack = C.el('div', { className: 'ac-now-playing__stack' });
				trackSection = buildTrackSection(track);
				stack.appendChild(trackSection);
				stack.appendChild(optionsSection);
				stack.appendChild(chaptersSection);
				stack.appendChild(queueSection);
				body.appendChild(stack);
				paintChaptersList(track);
				paintSeek();
				paintTransport();
				paintStatusMeta();
				paintControls();
				paintSleepTimer();
			}

			function paintQueue() {
				const track = AudioCheckPlayer.getCurrentTrack();
				if (!track || !queueUl || !queueUl.parentElement) return;
				const sig = queueSignature();
				if (sig === lastQueueSig) return;
				lastQueueSig = sig;
				const queue = AudioCheckPlayer.getQueue();
				const cur = AudioCheckPlayer.getCurrentIndex();
				const a = document.getElementById('ac-audio');
				const playing = !!(a && !a.paused);
				if (queueMeta) {
					if (queue.length === 1) {
						queueMeta.textContent = t('audiocheck', '1 track in queue');
					} else if (queue.length) {
						queueMeta.textContent = t('audiocheck', '{count} tracks in queue', { count: String(queue.length) });
					} else {
						queueMeta.textContent = '';
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
				const shuffleOn = AudioCheckPlayer.getShuffle();
				queue.forEach((qTrack, i) => {
					const rowTrack = trackForQueueRow(qTrack, i, cur);
					const canReorder = !shuffleOn && queue.length > 1;
					const rowOpts = window.AudioCheckTrackListUi
						? AudioCheckTrackListUi.trackRowOptions(rowTrack, {
							rowVariant: 'queue',
							active: i === cur,
							playing: i === cur && playing,
							removeLabel: t('audiocheck', 'Remove from queue'),
							onRemove: () => AudioCheckPlayer.removeAt(i),
							onMoveUp: canReorder && i > 0 ? () => AudioCheckPlayer.moveItem(i, i - 1) : null,
							onMoveDown: canReorder && i < queue.length - 1 ? () => AudioCheckPlayer.moveItem(i, i + 1) : null,
							moveUpDisabled: i === 0,
							moveDownDisabled: i >= queue.length - 1,
						})
						: {
							rowVariant: 'queue',
							active: i === cur,
							playing: i === cur && playing,
							removeLabel: t('audiocheck', 'Remove from queue'),
							onRemove: () => AudioCheckPlayer.removeAt(i),
							onMoveUp: canReorder && i > 0 ? () => AudioCheckPlayer.moveItem(i, i - 1) : null,
							onMoveDown: canReorder && i < queue.length - 1 ? () => AudioCheckPlayer.moveItem(i, i + 1) : null,
							moveUpDisabled: i === 0,
							moveDownDisabled: i >= queue.length - 1,
						};
					const playHandler = queue.length > 1 && typeof AudioCheckPlayer.playQueueFromHere === 'function'
						? () => AudioCheckPlayer.playQueueFromHere(queue, i)
						: () => AudioCheckPlayer.playQueue(queue, i);
					queueUl.appendChild(C.trackRow(rowTrack, playHandler, rowOpts));
				});
				paintStatusMeta();
			}

			function updateOptionRow(row, opts) {
				if (!row) return;
				const valueEl = row.querySelector('.ac-playback-option__value');
				if (valueEl) valueEl.textContent = opts.value;
				row.setAttribute('aria-label', opts.ariaLabel);
				row.setAttribute('aria-pressed', opts.active ? 'true' : 'false');
				row.classList.toggle('ac-playback-option--active', !!opts.active);
				row.disabled = !!opts.disabled;
				const iconEl = row.querySelector('.ac-playback-option__icon .ac-icon');
				if (iconEl && opts.icon && window.AudioCheckIcons) {
					AudioCheckIcons.mount(iconEl.parentElement, opts.icon);
				}
			}

			function paintControls() {
				const shuffleOn = AudioCheckPlayer.getShuffle();
				const repeatMode = AudioCheckPlayer.getRepeatMode();
				const policy = AudioCheckPlayer.getQueuePlaybackPolicy();
				const fromStart = policy.mode === 'sequential' && policy.resumeAnchorIndex === null;
				const queueLen = AudioCheckPlayer.getQueue().length;
				const shuffleDisabled = queueLen < 2;

				updateOptionRow(shuffleRow, {
					icon: 'shuffle',
					value: shuffleOn ? t('audiocheck', 'On') : t('audiocheck', 'Off'),
					ariaLabel: shuffleOn ? t('audiocheck', 'Shuffle on') : t('audiocheck', 'Shuffle off'),
					active: shuffleOn,
					disabled: shuffleDisabled,
				});
				updateOptionRow(repeatRow, {
					icon: repeatMode === AudioCheckConstants.REPEAT_ONE ? 'repeat-one' : 'repeat',
					value: repeatShortLabel(repeatMode),
					ariaLabel: repeatAriaLabel(repeatMode),
					active: repeatMode !== AudioCheckConstants.REPEAT_OFF,
					disabled: queueLen === 0,
				});
				if (startModeRow) {
					startModeRow.hidden = queueLen <= 1;
					updateOptionRow(startModeRow, {
						icon: fromStart ? 'playlist' : 'history',
						value: fromStart
							? t('audiocheck', 'From the beginning')
							: t('audiocheck', 'Continue where you left off'),
						ariaLabel: fromStart
							? t('audiocheck', 'From the beginning')
							: t('audiocheck', 'Continue where you left off'),
						active: fromStart,
						disabled: queueLen <= 1,
					});
				}
				if (speed) {
					const curSpeed = AudioCheckConstants.SPEED_PRESETS.includes(
						Math.round((document.getElementById('ac-audio')?.playbackRate || 1) * 100)
					) ? Math.round((document.getElementById('ac-audio')?.playbackRate || 1) * 100) : 100;
					speed.value = String(curSpeed);
				}
			}

			const unsub = AudioCheckPlayer.subscribe(() => {
				paintNow();
				paintQueue();
				paintControls();
				paintSleepTimer();
			});
			let sleepUnsub = null;
			if (window.AudioCheckSleepTimer) {
				sleepUnsub = AudioCheckSleepTimer.subscribe(() => paintSleepTimer());
			}

			frag.appendChild(body);

			paintNow();
			paintQueue();
			paintControls();
			paintSleepTimer();

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
					if (sleepUnsub) sleepUnsub();
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
