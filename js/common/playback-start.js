(function () {
	'use strict';

	const C = () => window.AudioCheckComponents;
	const QPM = () => window.AudioCheckQueuePlaybackMode;

	function progressByFileId(fileIds, continueItems) {
		const byId = new Map();
		(continueItems || []).forEach((item) => {
			if (item && item.fileId) byId.set(item.fileId, item);
		});
		return byId;
	}

	function findResumeQueueIndex(fileIds, continueItems) {
		const byId = progressByFileId(fileIds, continueItems);
		for (let i = 0; i < fileIds.length; i++) {
			const entry = byId.get(fileIds[i]);
			if (entry && entry.positionMs > 0 && !entry.finished) return i;
		}
		for (let i = 0; i < fileIds.length; i++) {
			const entry = byId.get(fileIds[i]);
			if (entry && entry.positionMs > 0) return i;
		}
		return 0;
	}

	function hasResumableProgress(fileIds, continueItems) {
		const byId = progressByFileId(fileIds, continueItems);
		return fileIds.some((fileId) => {
			const entry = byId.get(fileId);
			return !!entry && entry.positionMs > 0 && !entry.finished;
		});
	}

	function fetchContinueItems() {
		return AudioCheckApi.get('/apps/audiocheck/api/progress').then((data) => {
			return (data.progress && data.progress.continue) || [];
		});
	}

	/**
	 * @param {object} opts
	 * @param {number} opts.trackCount
	 * @param {boolean} opts.showResumeChoice
	 * @param {() => void} opts.onPlayFromStart
	 * @param {() => void} [opts.onContinue]
	 * @param {() => void} [opts.onShuffle]
	 * @param {boolean} [opts.disabled]
	 */
	function renderPlaybackStartActions(opts) {
		const Cm = C();
		if (!Cm) return document.createDocumentFragment();
		const root = Cm.el('div', { className: 'ac-playback-start' });

		if (opts.showResumeChoice) {
			const card = Cm.el('div', {
				className: 'ac-playback-start__choice',
				attrs: { role: 'group', 'aria-label': t('audiocheck', 'How to play this list') },
			});
			card.appendChild(Cm.el('h4', {
				className: 'ac-playback-start__choice-title',
				text: t('audiocheck', 'How to play this list'),
			}));
			const list = Cm.el('ul', { className: 'ac-playback-start__choice-list' });
			[
				t('audiocheck', 'Play every file from the start — all files begin at 0:00.'),
				t('audiocheck', 'Continue where you left off — each file resumes at your saved position.'),
			].forEach((line) => {
				const li = Cm.el('li', { text: line });
				list.appendChild(li);
			});
			card.appendChild(list);
			root.appendChild(card);
		}

		const actions = Cm.el('div', {
			className: 'ac-playback-start__actions',
			attrs: { role: 'group', 'aria-label': t('audiocheck', 'Play actions') },
		});

		const playLabel = opts.showResumeChoice
			? t('audiocheck', 'Play every file from the start ({count})', { count: String(opts.trackCount) })
			: (opts.trackCount === 1
				? t('audiocheck', 'Play')
				: t('audiocheck', 'Play all'));
		actions.appendChild(Cm.el('button', {
			type: 'button',
			className: 'ac-btn ac-btn--primary',
			text: playLabel,
			disabled: !!opts.disabled,
			onClick: opts.onPlayFromStart,
		}));

		if (opts.showResumeChoice && opts.onContinue) {
			actions.appendChild(Cm.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Continue where you left off ({count})', { count: String(opts.trackCount) }),
				disabled: !!opts.disabled,
				onClick: opts.onContinue,
			}));
		}

		if (opts.trackCount > 1 && opts.onShuffle) {
			actions.appendChild(Cm.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Shuffle play'),
				disabled: !!opts.disabled,
				onClick: opts.onShuffle,
			}));
		}

		root.appendChild(actions);

		if (opts.showResumeChoice) {
			root.appendChild(Cm.el('p', {
				className: 'ac-field__hint ac-playback-start__note',
				text: t('audiocheck', 'Your saved position is kept if you stop early.'),
			}));
		}

		return root;
	}

	function startCollectionPlayback(tracks, options) {
		const opts = options || {};
		const playable = (tracks || []).filter((tr) => tr && !tr.unavailable);
		if (!playable.length) return;
		const startIndex = typeof opts.startIndex === 'number' ? opts.startIndex : 0;
		const mode = opts.playbackMode || 'sequential';
		const Q = QPM();
		const policy = Q.resolvePlaybackPolicyForQueueStart({
			fileCount: playable.length,
			explicitMode: mode,
			currentIndex: startIndex,
			resumeAnchorIndex: opts.resumeAnchorIndex,
		});
		AudioCheckPlayer.setQueuePlaybackPolicy(policy);
		let positionMs = 0;
		if (mode === 'resume' && playable.length === 1) {
			positionMs = opts.positionMs || 0;
		} else if (policy.resumeAnchorIndex !== null && policy.resumeAnchorIndex === startIndex) {
			positionMs = opts.positionMs || 0;
		}
		if (opts.shuffle) AudioCheckPlayer.setShuffle(true);
		AudioCheckPlayer.playQueue(playable, startIndex, positionMs, opts.autoplay !== false, {
			playbackPolicy: policy,
		});
		if (window.AudioCheckRouter) {
			AudioCheckRouter.navigate('now-playing', {}, true);
		}
	}

	function mountExpandPlayActions(container, options) {
		const Cm = C();
		if (!Cm || !container) return Promise.resolve();
		const getTracks = options.getTracks;
		const trackCount = options.trackCount || 0;
		if (!getTracks || trackCount <= 0) {
			container.textContent = '';
			return Promise.resolve();
		}
		return fetchContinueItems().then((continueItems) => Promise.resolve(getTracks()).then((tracks) => {
			const playable = (tracks || []).filter((tr) => tr && !tr.unavailable);
			container.textContent = '';
			if (!playable.length) return;
			const fileIds = playable.map((tr) => tr.fileId);
			const showResumeChoice = playable.length > 1 && hasResumableProgress(fileIds, continueItems);
			const resumeIndex = findResumeQueueIndex(fileIds, continueItems);
			container.appendChild(renderPlaybackStartActions({
				trackCount: trackCount || playable.length,
				showResumeChoice,
				onPlayFromStart: () => startCollectionPlayback(playable, { playbackMode: 'sequential' }),
				onContinue: showResumeChoice ? () => {
					const anchorItem = (continueItems || []).find((item) => item.fileId === fileIds[resumeIndex]);
					const positionMs = anchorItem && !anchorItem.finished
						? Math.max(0, anchorItem.positionMs || 0)
						: 0;
					startCollectionPlayback(playable, {
						playbackMode: 'resume',
						resumeAnchorIndex: resumeIndex,
						startIndex: resumeIndex,
						positionMs,
					});
				} : undefined,
				onShuffle: playable.length > 1
					? () => startCollectionPlayback(playable, { playbackMode: 'sequential', shuffle: true })
					: undefined,
			}));
		})).catch(() => {
			container.textContent = '';
		});
	}

	function playAllWithStartChoice(tracks, options) {
		const opts = options || {};
		const playable = (tracks || []).filter((tr) => tr && !tr.unavailable);
		if (!playable.length) {
			AudioCheckMessaging.toast(t('audiocheck', 'Nothing here yet'), 'warning');
			return Promise.resolve();
		}
		if (playable.length === 1) {
			startCollectionPlayback(playable, opts);
			return Promise.resolve();
		}
		return fetchContinueItems().then((continueItems) => {
			const fileIds = playable.map((tr) => tr.fileId);
			const showResumeChoice = hasResumableProgress(fileIds, continueItems);
			if (!showResumeChoice) {
				startCollectionPlayback(playable, Object.assign({ playbackMode: 'sequential' }, opts));
				return;
			}
			const Cm = C();
			if (!Cm || !Cm.openModal) {
				startCollectionPlayback(playable, Object.assign({ playbackMode: 'sequential' }, opts));
				return;
			}
			const resumeIndex = findResumeQueueIndex(fileIds, continueItems);
			Cm.openModal({
				title: t('audiocheck', 'How to play this list'),
				hideDefaultActions: true,
				render(ctx) {
					const closeModal = ctx && typeof ctx.close === 'function' ? ctx.close : null;
					const wrap = Cm.el('div', {});
					wrap.appendChild(renderPlaybackStartActions({
						trackCount: playable.length,
						showResumeChoice: true,
						onPlayFromStart: () => {
							startCollectionPlayback(playable, Object.assign({ playbackMode: 'sequential' }, opts));
							if (closeModal) closeModal(true);
						},
						onContinue: () => {
							const anchorItem = (continueItems || []).find((item) => item.fileId === fileIds[resumeIndex]);
							const positionMs = anchorItem && !anchorItem.finished
								? Math.max(0, anchorItem.positionMs || 0)
								: 0;
							startCollectionPlayback(playable, Object.assign({
								playbackMode: 'resume',
								resumeAnchorIndex: resumeIndex,
								startIndex: resumeIndex,
								positionMs,
							}, opts));
							if (closeModal) closeModal(true);
						},
						onShuffle: playable.length > 1
							? () => {
								startCollectionPlayback(playable, Object.assign({
									playbackMode: 'sequential',
									shuffle: true,
								}, opts));
								if (closeModal) closeModal(true);
							}
							: undefined,
					}));
					return wrap;
				},
			});
		});
	}

	window.AudioCheckPlaybackStart = {
		findResumeQueueIndex,
		hasResumableProgress,
		fetchContinueItems,
		renderPlaybackStartActions,
		startCollectionPlayback,
		playAllWithStartChoice,
		mountExpandPlayActions,
	};
})();
