(function () {
	'use strict';
	const C = AudioCheckComponents;
	AudioCheckRouter.register('settings', {
		render() {
			const frag = document.createDocumentFragment();
			frag.appendChild(C.pageHeader(t('audiocheck', 'Settings'), t('audiocheck', 'Personal playback and scan preferences.')));

			const form = C.el('form', { className: 'ac-card ac-form' });

			const playbackFs = C.el('fieldset', { className: 'ac-fieldset' });
			playbackFs.appendChild(C.el('legend', { className: 'ac-fieldset__legend', text: t('audiocheck', 'Playback') }));

			const speedRow = C.el('div', { className: 'ac-form-row' });
			speedRow.appendChild(C.el('label', { attrs: { for: 'ac-default-speed' }, text: t('audiocheck', 'Default playback speed') }));
			const speed = C.el('select', { id: 'ac-default-speed', className: 'ac-input', attrs: { 'aria-describedby': 'ac-speed-hint' } });
			AudioCheckConstants.SPEED_PRESETS.forEach((s) => {
				const o = document.createElement('option');
				o.value = String(s);
				o.textContent = (s / 100).toFixed(2) + '×';
				speed.appendChild(o);
			});
			speedRow.appendChild(speed);
			speedRow.appendChild(C.el('p', { id: 'ac-speed-hint', className: 'ac-field__hint', text: t('audiocheck', 'Used when you start playing a new track.') }));

			const volumeRow = C.el('div', { className: 'ac-form-row' });
			volumeRow.appendChild(C.el('label', { attrs: { for: 'ac-default-volume' }, text: t('audiocheck', 'Default volume') }));
			const volumeWrap = C.el('div', { className: 'ac-settings-volume' });
			const volumeSlider = C.el('input', {
				type: 'range',
				id: 'ac-default-volume',
				className: 'ac-volume__slider',
				attrs: {
					min: '0',
					max: '100',
					value: '100',
					'aria-describedby': 'ac-volume-hint',
					'aria-valuetext': t('audiocheck', 'Volume {percent}%', { percent: '100' }),
				},
			});
			const volumeValue = C.el('span', { className: 'ac-volume__value', id: 'ac-default-volume-value', text: '100%' });
			volumeWrap.appendChild(volumeSlider);
			volumeWrap.appendChild(volumeValue);
			volumeRow.appendChild(volumeWrap);
			volumeRow.appendChild(C.el('p', {
				id: 'ac-volume-hint',
				className: 'ac-field__hint',
				text: t('audiocheck', 'Applied when you open AudioCheck. You can also change volume in the mini player or Now playing.'),
			}));

			const resumeRow = C.el('div', { className: 'ac-form-row ac-form-row--checkbox' });
			const resume = C.el('input', { id: 'ac-resume-on-open', type: 'checkbox' });
			resumeRow.appendChild(resume);
			resumeRow.appendChild(C.el('label', { attrs: { for: 'ac-resume-on-open' }, text: t('audiocheck', 'Resume where you left off') }));
			resumeRow.appendChild(C.el('p', { id: 'ac-resume-hint', className: 'ac-field__hint', text: t('audiocheck', 'When enabled, opening a track continues from your saved position.') }));

			playbackFs.appendChild(speedRow);
			playbackFs.appendChild(volumeRow);
			playbackFs.appendChild(resumeRow);

			const scanFs = C.el('fieldset', { className: 'ac-fieldset' });
			scanFs.appendChild(C.el('legend', { className: 'ac-fieldset__legend', text: t('audiocheck', 'Library scanning') }));
			const subRow = C.el('div', { className: 'ac-form-row ac-form-row--checkbox' });
			const subfolders = C.el('input', { id: 'ac-scan-subfolders', type: 'checkbox' });
			subRow.appendChild(subfolders);
			subRow.appendChild(C.el('label', { attrs: { for: 'ac-scan-subfolders' }, text: t('audiocheck', 'Scan subfolders') }));
			subRow.appendChild(C.el('p', { className: 'ac-field__hint', text: t('audiocheck', 'Include files in subfolders when scanning. Used for new library folders and the default folder.') }));
			scanFs.appendChild(subRow);

			const actions = C.el('div', { className: 'ac-form-actions' });
			actions.appendChild(C.el('button', { type: 'submit', className: 'ac-btn ac-btn--primary', text: t('audiocheck', 'Save') }));

			form.appendChild(playbackFs);
			form.appendChild(scanFs);
			form.appendChild(actions);

			function updateVolumeLabel(v) {
				volumeValue.textContent = v + '%';
				volumeSlider.setAttribute('aria-valuetext', t('audiocheck', 'Volume {percent}%', { percent: String(v) }));
			}

			volumeSlider.addEventListener('input', () => {
				const v = parseInt(volumeSlider.value, 10);
				updateVolumeLabel(v);
				AudioCheckPlayer.setVolumePercent(v, { persist: false });
			});

			form.addEventListener('submit', (e) => {
				e.preventDefault();
				const vol = parseInt(volumeSlider.value, 10);
				AudioCheckApi.put('/apps/audiocheck/api/prefs', {
					defaultSpeed: parseInt(speed.value, 10),
					defaultVolume: vol,
					resumeOnOpen: resume.checked,
					scanSubfolders: subfolders.checked,
				})
					.then((r) => {
						window.AudioCheckUserPrefs = r.prefs || {};
						AudioCheckPlayer.setSpeed(parseInt(speed.value, 10));
						AudioCheckPlayer.setVolumePercent(vol, { persist: false });
						AudioCheckMessaging.toast(t('audiocheck', 'Saved.'));
					})
					.catch((err) => AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error'));
			});

			AudioCheckApi.get('/apps/audiocheck/api/prefs').then((r) => {
				speed.value = String(typeof r.prefs.defaultSpeed === 'number' ? r.prefs.defaultSpeed : 100);
				resume.checked = r.prefs.resumeOnOpen !== false;
				subfolders.checked = r.prefs.scanSubfolders !== false;
				const vol = typeof r.prefs.defaultVolume === 'number' ? r.prefs.defaultVolume : AudioCheckPlayer.getVolumePercent();
				volumeSlider.value = String(vol);
				updateVolumeLabel(vol);
			}).catch((err) => AudioCheckMessaging.toast(err.message || t('audiocheck', 'Request failed.'), 'error'));

			const onScreen = C.el('div', { className: 'ac-card ac-controls-ref' });
			onScreen.appendChild(C.el('h2', { className: 'ac-card__title', text: t('audiocheck', 'On-screen controls') }));
			onScreen.appendChild(C.el('p', {
				className: 'ac-field__hint ac-controls-ref__intro',
				text: t('audiocheck', 'You can control playback without the keyboard. Look for these controls:'),
			}));
			const refList = C.el('dl', { className: 'ac-controls-ref__list' });
			[
				[t('audiocheck', 'Mini player (bottom bar)'), t('audiocheck', 'Play, pause, previous, next, seek, volume, and open Now playing.')],
				[t('audiocheck', 'Now playing'), t('audiocheck', 'Full player with cover, seek bar, shuffle, repeat, speed, volume, queue, and chapters.')],
				[t('audiocheck', 'This page'), t('audiocheck', 'Default speed, volume, and resume preferences.')],
			].forEach(([where, what]) => {
				refList.appendChild(C.el('dt', { text: where }));
				refList.appendChild(C.el('dd', { text: what }));
			});
			onScreen.appendChild(refList);
			onScreen.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Now playing'),
				onClick: () => AudioCheckRouter.navigate('now-playing', {}, true),
			}));

			const shortcuts = C.el('div', { className: 'ac-card ac-shortcuts' });
			shortcuts.appendChild(C.el('h2', { className: 'ac-card__title', text: t('audiocheck', 'Keyboard shortcuts') }));
			shortcuts.appendChild(C.el('p', {
				className: 'ac-field__hint',
				text: t('audiocheck', 'Shortcuts work when no text field is focused and no dialog is open.'),
			}));
			const dl = C.el('dl', { className: 'ac-shortcuts__list' });
			[
				[t('audiocheck', 'Space or K'), t('audiocheck', 'Play / pause')],
				[t('audiocheck', 'M'), t('audiocheck', 'Mute / unmute')],
				[t('audiocheck', '← / →'), t('audiocheck', 'Seek 10 seconds')],
				[t('audiocheck', 'Shift + ← / →'), t('audiocheck', 'Previous / next track')],
				[t('audiocheck', '↑ / ↓'), t('audiocheck', 'Volume up / down')],
				[t('audiocheck', '[ / ]'), t('audiocheck', 'Slower / faster')],
				[t('audiocheck', 'J / L'), t('audiocheck', 'Previous / next chapter')],
			].forEach(([key, desc]) => {
				dl.appendChild(C.el('dt', { text: key }));
				dl.appendChild(C.el('dd', { text: desc }));
			});
			shortcuts.appendChild(dl);

			const libraryLink = C.el('div', { className: 'ac-card ac-settings-library' });
			libraryLink.appendChild(C.el('h2', { className: 'ac-card__title', text: t('audiocheck', 'Library folders') }));
			libraryLink.appendChild(C.el('p', {
				className: 'ac-field__hint',
				text: t('audiocheck', 'Add or remove folders to scan in the Library section.'),
			}));
			libraryLink.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Library'),
				onClick: () => AudioCheckRouter.navigate('library', {}, true),
			}));

			frag.appendChild(form);
			frag.appendChild(C.section(t('audiocheck', 'Controls'), onScreen));
			frag.appendChild(C.section(t('audiocheck', 'Help'), shortcuts));
			frag.appendChild(C.section(t('audiocheck', 'Library'), libraryLink));
			return frag;
		},
	});
})();
