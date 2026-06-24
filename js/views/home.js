(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;
	const UIL = () => (window.AudioCheckRequireTrackListUi
		? AudioCheckRequireTrackListUi()
		: window.AudioCheckTrackListUi);
	const GS = () => window.AudioCheckGlobalSearch;
	const LPU = () => window.AudioCheckLibraryPageUi;

	function searchQuery() {
		const g = GS();
		return g ? g.apiQueryParam(g.getDebouncedQuery()) : '';
	}

	function resumeContinueItem(cont, index) {
		const item = cont[index];
		if (!item || item.unavailable) return;
		if (typeof item.playbackSpeed === 'number' && item.playbackSpeed > 0) {
			AudioCheckPlayer.setSpeed(item.playbackSpeed);
		}
		const positionMs = item.finished ? 0 : Math.max(0, item.positionMs || 0);
		if (cont.length > 1 && typeof AudioCheckPlayer.playQueueFromHere === 'function') {
			AudioCheckPlayer.playQueueFromHere(cont, index, positionMs);
		} else {
			AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId: item.fileId } })
				.then((r) => {
					if (r.track) AudioCheckPlayer.playQueue([r.track], 0, positionMs);
				})
				.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
		}
		AudioCheckRouter.navigate('now-playing', {}, true);
	}

	function playRecentTrack(tracks, idx) {
		if (UIL()) {
			UIL().playTracksFromIndex(tracks, idx);
		} else {
			AudioCheckPlayer.playQueue(tracks, idx);
			AudioCheckRouter.navigate('now-playing', {}, true);
		}
	}

	function createHomeSection(title, id, leadText) {
		const section = C.el('section', {
			className: 'ac-card ac-section ac-home-section',
			attrs: id ? { 'aria-labelledby': id } : {},
		});
		if (title) {
			const LPU = window.AudioCheckLibraryPageUi;
			section.appendChild(LPU
				? LPU.sectionHeading(title, id)
				: C.el('h2', { id, className: 'ac-section__title', text: title }));
		}
		if (leadText) {
			section.appendChild(C.el('p', {
				className: 'ac-section__lead ac-home-section__lead',
				text: leadText,
			}));
		}
		return section;
	}

	function trackMatchesSearch(track, q) {
		if (!q) return true;
		const g = GS();
		if (!g) return true;
		return g.matchesSearchQuery([
			track.title,
			track.artist,
			track.album,
			track.fileName,
		], q);
	}

	function filterContinueItems(items, q) {
		if (!q) return items || [];
		return (items || []).filter((item) => trackMatchesSearch(item, q));
	}

	function buildContinueHero(hero, cont, heroIndex) {
		const card = C.el('article', { className: 'ac-home-hero ac-home-hero--card' });
		const layout = C.el('div', { className: 'ac-home-hero__layout' });
		const coverWrap = C.coverImageWrap(hero.fileId, 'ac-home-hero__cover-wrap');
		const pos = hero.finished ? 0 : Math.max(0, hero.positionMs || 0);
		const dur = Math.max(0, hero.durationMs || 0);
		if (dur > 0 && pos > 0 && pos < dur) {
			const pct = Math.min(100, Math.round((pos / dur) * 100));
			coverWrap.appendChild(C.el('div', {
				className: 'ac-card__progress',
				attrs: { 'aria-hidden': 'true', style: '--ac-progress:' + String(pct) },
			}));
		}
		layout.appendChild(coverWrap);

		const body = C.el('div', { className: 'ac-home-hero__body' });
		const title = hero.title || '';
		body.appendChild(C.el('h3', { className: 'ac-home-hero__title', text: title }));
		if (hero.unavailable) {
			body.appendChild(C.el('p', {
				className: 'ac-home-hero__badge',
				attrs: { role: 'status' },
				text: t('audiocheck', 'File unavailable.'),
			}));
		}
		const metaParts = [hero.artist, hero.album].filter(Boolean);
		if (metaParts.length) {
			body.appendChild(C.el('p', {
				className: 'ac-home-hero__artist',
				text: metaParts.join(' · '),
			}));
		}
		body.appendChild(C.el('p', {
			className: 'ac-field__hint ac-home-hero__progress',
			text: t('audiocheck', 'Resume at {position} of {duration}', {
				position: AudioCheckTime.formatMs(pos),
				duration: AudioCheckTime.formatDuration(dur),
			}),
		}));
		const resumeLabel = t('audiocheck', 'Resume now');
		body.appendChild(C.el('button', {
			type: 'button',
			className: 'ac-btn ac-btn--primary ac-home-hero__resume',
			text: resumeLabel,
			attrs: {
				'aria-label': title
					? t('audiocheck', 'Resume {title}', { title })
					: resumeLabel,
				disabled: hero.unavailable ? true : undefined,
			},
			onClick: () => resumeContinueItem(cont, heroIndex),
		}));
		layout.appendChild(body);
		card.appendChild(layout);
		return card;
	}

	function buildLoadingState() {
		return C.el('div', {
			className: 'ac-home-loading',
			attrs: { role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' },
		}, [
			C.el('p', { className: 'ac-sr-only', text: t('audiocheck', 'Loading your library…') }),
			C.el('span', { className: 'ac-skeleton ac-skeleton--title' }),
			C.el('span', { className: 'ac-skeleton ac-skeleton--card' }),
			C.el('span', { className: 'ac-skeleton ac-skeleton--row' }),
			C.el('span', { className: 'ac-skeleton ac-skeleton--row' }),
		]);
	}

	function buildErrorState(message, onRetry) {
		return C.emptyState(
			t('audiocheck', 'Could not load home'),
			message || t('audiocheck', 'Request failed.'),
			{
				icon: 'app',
				variant: 'section',
				ctaLabel: t('audiocheck', 'Try again'),
				onCta: onRetry,
			},
		);
	}

	AudioCheckRouter.register('home', {
		render() {
			const frag = document.createDocumentFragment();

			const body = C.el('div', { className: 'ac-page-body ac-home-page' });
			const shell = LPU()
				? LPU().createContentShell(t('audiocheck', 'Home'))
				: C.el('section', { className: 'ac-library-shell', attrs: { 'aria-label': t('audiocheck', 'Home') } });
			let searchHintEl = LPU() ? LPU().buildSearchHint(searchQuery) : null;
			if (searchHintEl) shell.appendChild(searchHintEl);

			const quickSection = C.el('section', {
				className: 'ac-card ac-section ac-home-quick',
				attrs: { 'aria-labelledby': 'ac-home-quick-heading' },
			});
			if (LPU()) {
				quickSection.appendChild(LPU().sectionHeading(
					t('audiocheck', 'Quick actions'),
					'ac-home-quick-heading',
				));
			} else {
				quickSection.appendChild(C.el('h2', {
					id: 'ac-home-quick-heading',
					className: 'ac-section__title',
					text: t('audiocheck', 'Quick actions'),
				}));
			}
			quickSection.appendChild(C.el('p', {
				className: 'ac-section__lead ac-home-section__lead',
				text: t('audiocheck', 'Jump back in or manage your folders.'),
			}));
			const quickInner = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-home-quick__actions' });
			quickInner.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Shuffle a playlist'),
				onClick: () => { if (PA()) PA().shufflePinnedPlaylist(); },
			}));
			quickInner.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Library'),
				onClick: () => AudioCheckRouter.navigate('library', {}, true),
			}));
			quickSection.appendChild(quickInner);
			shell.appendChild(quickSection);

			const contentHost = C.el('div', { className: 'ac-home-sections' });
			shell.appendChild(contentHost);
			body.appendChild(shell);
			frag.appendChild(body);

			function refreshSearchHint() {
				if (searchHintEl && typeof searchHintEl.refresh === 'function') {
					searchHintEl.refresh();
				}
			}

			function appendSectionHeader(section, seeAllRoute) {
				if (!seeAllRoute) return;
				const titleEl = section.querySelector('.ac-section__title');
				if (!titleEl) return;
				const row = C.el('div', { className: 'ac-home-section__header' });
				titleEl.replaceWith(row);
				row.appendChild(titleEl);
				row.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--compact ac-home-section__see-all',
					text: t('audiocheck', 'See all'),
					onClick: () => AudioCheckRouter.navigate(seeAllRoute, {}, true),
				}));
			}

			function reloadHome() {
				refreshSearchHint();
				contentHost.textContent = '';
				contentHost.appendChild(buildLoadingState());

				const recentParams = { sort: 'added', limit: 8 };
				const q = searchQuery();
				if (q) recentParams.q = q;

				Promise.all([
					AudioCheckApi.get('/apps/audiocheck/api/progress'),
					AudioCheckApi.get('/apps/audiocheck/api/tracks', recentParams),
					AudioCheckApi.get('/apps/audiocheck/api/collections', { kind: 'audiobook', limit: 8 }),
					AudioCheckApi.get('/apps/audiocheck/api/collections', { kind: 'music', limit: 8 }),
				]).then(([progress, recent, audioBooks, music]) => {
					contentHost.textContent = '';
					const contAll = progress.progress?.continue || [];
					const contFiltered = filterContinueItems(contAll, q);
					const recentItems = recent.items || [];
					const hasLibrary = recentItems.length > 0
						|| (audioBooks.items?.length || 0) > 0
						|| (music.items?.length || 0) > 0;
					const searchActive = !!q;
					const noSearchResults = searchActive
						&& contFiltered.length === 0
						&& recentItems.length === 0;

					if (noSearchResults) {
						contentHost.appendChild(C.emptyState(
							t('audiocheck', 'No matching tracks.'),
							t('audiocheck', 'Try a different search term or clear the search bar above.'),
							{ icon: 'music', variant: 'section' },
						));
						return;
					}

					if (contFiltered.length) {
						const section = createHomeSection(
							t('audiocheck', 'Continue listening'),
							'ac-home-continue-heading',
							t('audiocheck', 'Tap a title to resume from your last position.'),
						);
						section.classList.add('ac-home-continue');
						const hero = contFiltered[0];
						const heroIndex = contAll.findIndex((item) => item.fileId === hero.fileId);
						section.appendChild(buildContinueHero(hero, contAll, heroIndex >= 0 ? heroIndex : 0));

						const moreItems = contFiltered.slice(1, 6);
						if (moreItems.length) {
							const ul = C.el('ul', { className: 'ac-track-list ac-home-continue__more' });
							const cache = [];
							moreItems.forEach((item) => {
								const idx = contAll.findIndex((row) => row.fileId === item.fileId);
								const track = Object.assign({}, item, {
									listened: !!(item.listened || item.finished),
								});
								if (!track.unavailable) cache.push(track);
								const playIdx = cache.indexOf(track);
								const rowOpts = UIL() ? UIL().trackRowOptions(track) : {};
								ul.appendChild(C.trackRow(track, playIdx >= 0 && idx >= 0
									? () => resumeContinueItem(contAll, idx)
									: null, rowOpts));
							});
							section.appendChild(ul);
						}
						contentHost.appendChild(section);
					} else if (!hasLibrary && !searchActive) {
						contentHost.appendChild(C.emptyState(
							t('audiocheck', 'No audio found yet'),
							t('audiocheck', 'Add a folder in Library and scan to build your collection.'),
							{
								icon: 'folder',
								ctaLabel: t('audiocheck', 'Open Library'),
								onCta: () => AudioCheckRouter.navigate('library', {}, true),
							},
						));
						return;
					} else {
						const section = createHomeSection(
							t('audiocheck', 'Continue listening'),
							'ac-home-continue-heading',
							t('audiocheck', 'Tap a title to resume from your last position.'),
						);
						section.appendChild(C.el('p', {
							className: 'ac-field__hint ac-home-section__empty',
							attrs: { role: 'status' },
							text: searchActive
								? t('audiocheck', 'No in-progress tracks match your search.')
								: t('audiocheck', 'Nothing in progress right now.'),
						}));
						contentHost.appendChild(section);
					}

					const recentSection = createHomeSection(
						t('audiocheck', 'Recently added'),
						'ac-home-recent-heading',
						t('audiocheck', 'Fresh tracks from your library.'),
					);
					if (recentItems.length) {
						const ul = C.el('ul', { className: 'ac-track-list' });
						const cache = [];
						recentItems.forEach((tr) => {
							let playIdx = -1;
							if (!tr.unavailable) {
								playIdx = cache.length;
								cache.push(tr);
							}
							const rowOpts = UIL() ? UIL().trackRowOptions(tr) : {};
							ul.appendChild(C.trackRow(tr, playIdx >= 0
								? () => playRecentTrack(cache, playIdx)
								: null, rowOpts));
						});
						recentSection.appendChild(ul);
					} else {
						recentSection.appendChild(C.el('p', {
							className: 'ac-field__hint ac-home-section__empty',
							attrs: { role: 'status' },
							text: searchActive
								? t('audiocheck', 'No recently added tracks match your search.')
								: t('audiocheck', 'No tracks found in your library yet.'),
						}));
					}
					contentHost.appendChild(recentSection);

					if (searchActive) {
						const hasCollections = (audioBooks.items?.length || 0) > 0
							|| (music.items?.length || 0) > 0;
						if (hasCollections) {
							contentHost.appendChild(C.el('p', {
								className: 'ac-field__hint ac-home-collections-hint',
								attrs: { role: 'status' },
								text: t('audiocheck', 'Album and audiobook shortcuts are hidden while searching. Clear the search to browse collections.'),
							}));
						}
					} else {
						if (audioBooks.items?.length) {
							const section = createHomeSection(
								t('audiocheck', 'Audiobooks'),
								'ac-home-audiobooks-heading',
								null,
							);
							appendSectionHeader(section, 'audiobooks');
							const g = C.el('div', { className: 'ac-grid ac-home-grid' });
							audioBooks.items.forEach((c) => g.appendChild(C.mediaCard({
								title: c.title,
								subtitle: c.subtitle,
								coverFileId: c.coverFileId,
								listened: !!c.fullyListened,
								finished: !!c.fullyListened,
							}, () => {
								if (PA()) PA().openCollectionDetail(c.key, c.title);
							})));
							section.appendChild(g);
							contentHost.appendChild(section);
						}
						if (music.items?.length) {
							const section = createHomeSection(
								t('audiocheck', 'Music'),
								'ac-home-music-heading',
								null,
							);
							appendSectionHeader(section, 'music');
							const g = C.el('div', { className: 'ac-grid ac-home-grid' });
							music.items.forEach((c) => g.appendChild(C.mediaCard({
								title: c.title,
								subtitle: c.subtitle,
								coverFileId: c.coverFileId,
								listened: !!c.fullyListened,
								finished: !!c.fullyListened,
							}, () => {
								if (PA()) PA().openCollectionDetail(c.key, c.title);
							})));
							section.appendChild(g);
							contentHost.appendChild(section);
						}
					}
				}).catch((e) => {
					contentHost.textContent = '';
					contentHost.appendChild(buildErrorState(e.message, reloadHome));
				});
			}

			reloadHome();
			if (GS()) {
				GS().registerViewHandler('home', reloadHome);
			}
			return frag;
		},
	});
})();
