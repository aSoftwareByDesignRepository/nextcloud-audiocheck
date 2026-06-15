(function () {
	'use strict';
	const C = AudioCheckComponents;
	const PA = () => window.AudioCheckPlaylistActions;

	function playTracks(tracks, idx) {
		AudioCheckPlayer.playQueue(tracks, idx || 0);
	}

	AudioCheckRouter.register('home', {
		render() {
			const frag = document.createDocumentFragment();
			frag.appendChild(C.pageHeader(t('audiocheck', 'Home'), t('audiocheck', 'Continue listening and discover your audio library.')));

			const quick = C.el('section', { className: 'ac-quick-actions', attrs: { 'aria-label': t('audiocheck', 'Quick actions') } });
			const quickInner = C.el('div', { className: 'ac-toolbar ac-toolbar--compact' });
			const shuffleBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Shuffle a playlist'),
				onClick: () => { if (PA()) PA().shufflePinnedPlaylist(); },
			});
			const addFolderBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Library'),
				onClick: () => AudioCheckRouter.navigate('library', {}, true),
			});
			quickInner.appendChild(shuffleBtn);
			quickInner.appendChild(addFolderBtn);
			quick.appendChild(C.el('h2', { className: 'ac-section__title', text: t('audiocheck', 'Quick actions') }));
			quick.appendChild(quickInner);
			frag.appendChild(quick);

			const wrap = document.createElement('div');
			frag.appendChild(wrap);

			Promise.all([
				AudioCheckApi.get('/apps/audiocheck/api/progress'),
				AudioCheckApi.get('/apps/audiocheck/api/tracks', { sort: 'added', limit: 8 }),
				AudioCheckApi.get('/apps/audiocheck/api/collections', { kind: 'audiobook', limit: 8 }),
				AudioCheckApi.get('/apps/audiocheck/api/collections', { kind: 'music', limit: 8 }),
			]).then(([progress, recent, audioBooks, music]) => {
				wrap.textContent = '';
				const cont = progress.progress?.continue || [];
				const hasLibrary = (recent.items?.length || 0) > 0
					|| (audioBooks.items?.length || 0) > 0
					|| (music.items?.length || 0) > 0;

				if (cont.length) {
					const grid = document.createElement('div');
					grid.className = 'ac-grid';
					cont.forEach((item, i) => grid.appendChild(C.mediaCard({
						fileId: item.fileId,
						title: item.title,
						artist: item.artist,
						progressPercent: item.durationMs > 0
							? Math.min(100, Math.round((item.positionMs / item.durationMs) * 100))
							: 0,
						finished: !!item.finished,
					}, () => {
						if (typeof item.playbackSpeed === 'number' && item.playbackSpeed > 0) {
							AudioCheckPlayer.setSpeed(item.playbackSpeed);
						}
						AudioCheckPlayer.playQueue(cont, i, item.positionMs);
					})));
					wrap.appendChild(C.section(t('audiocheck', 'Continue listening'), grid));
				} else if (!hasLibrary) {
					wrap.appendChild(C.emptyState(
						t('audiocheck', 'No audio found yet'),
						t('audiocheck', 'Add a folder in Library and scan to build your collection.'),
						{
							icon: 'folder',
							ctaLabel: t('audiocheck', 'Open Library'),
							onCta: () => AudioCheckRouter.navigate('library', {}, true),
						},
					));
				} else {
					wrap.appendChild(C.section(
						t('audiocheck', 'Continue listening'),
						C.el('p', { className: 'ac-field__hint', text: t('audiocheck', 'Nothing in progress right now.') }),
					));
				}
				if (recent.items?.length) {
					const g = document.createElement('div'); g.className = 'ac-grid';
					recent.items.forEach((tr, i) => g.appendChild(C.mediaCard({
						fileId: tr.fileId,
						title: tr.title,
						subtitle: tr.artist,
						coverFileId: tr.fileId,
					}, () => playTracks(recent.items, i))));
					wrap.appendChild(C.section(t('audiocheck', 'Recently added'), g));
				}
				if (audioBooks.items?.length) {
					const g = document.createElement('div'); g.className = 'ac-grid';
					audioBooks.items.forEach((c) => g.appendChild(C.mediaCard({ title: c.title, subtitle: c.subtitle, coverFileId: c.coverFileId }, () => {
						if (PA()) PA().openCollectionDetail(c.key, c.title);
					})));
					wrap.appendChild(C.section(t('audiocheck', 'Audiobooks'), g));
				}
				if (music.items?.length) {
					const g = document.createElement('div'); g.className = 'ac-grid';
					music.items.forEach((c) => g.appendChild(C.mediaCard({ title: c.title, subtitle: c.subtitle, coverFileId: c.coverFileId }, () => {
						if (PA()) PA().openCollectionDetail(c.key, c.title);
					})));
					wrap.appendChild(C.section(t('audiocheck', 'Music'), g));
				}
			}).catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
			return frag;
		},
	});
})();
