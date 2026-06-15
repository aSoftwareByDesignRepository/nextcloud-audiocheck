(function () {
	'use strict';
	const C = AudioCheckComponents;
	AudioCheckRouter.register('library', {
		render() {
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body' });

			const status = C.el('p', { id: 'ac-scan-status', className: 'ac-scan-status', text: '…' });
			const cronCallout = C.el('p', {
				id: 'ac-cron-callout',
				className: 'ac-callout',
				attrs: { role: 'status', hidden: true },
				text: t('audiocheck', 'Background cron is not enabled on this server. Use Scan now to refresh your library, or ask an administrator to enable system cron in Nextcloud settings.'),
			});
			const scanPanel = C.el('div', { className: 'ac-library-scan' }, [status, cronCallout]);

			const scanBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Scan now'),
				onClick: () => {
					scanBtn.disabled = true;
					AudioCheckApi.post('/apps/audiocheck/api/scan').then(refresh).catch((e) => {
						AudioCheckMessaging.toast(e.message, 'error');
					}).finally(() => { scanBtn.disabled = false; });
				},
			});
			const addBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Add folder'),
				onClick: () => {
					addBtn.disabled = true;
					AudioCheckFolderPicker.pickFolder().then((fileId) => {
						if (!fileId) return;
						const prefs = window.AudioCheckUserPrefs || {};
						return AudioCheckApi.post('/apps/audiocheck/api/libraries', {
							rootFileId: fileId,
							includeSubfolders: prefs.scanSubfolders !== false,
						});
					}).then((r) => {
						if (r) {
							AudioCheckMessaging.toast(t('audiocheck', 'Folder added.'));
							refresh();
						}
					}).catch((e) => {
						if (AudioCheckFolderPicker.isPickerCancelled(e)) return;
						AudioCheckMessaging.toast(e.message, 'error');
					})
						.finally(() => { addBtn.disabled = false; });
				},
			});
			const headerActions = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-toolbar--wrap' });
			headerActions.appendChild(addBtn);
			headerActions.appendChild(scanBtn);

			frag.appendChild(C.pageHeader(
				t('audiocheck', 'Library'),
				t('audiocheck', 'Manage folders and scan your audio.'),
				headerActions,
			));

			const formats = C.el('p', {
				className: 'ac-field__hint',
				text: t('audiocheck', 'Usually plays in the browser: MP3, M4A, M4B, AAC, OGG, Opus, WAV. FLAC, WMA, and AIFF may need another app or browser.'),
			});

			function refresh() {
				AudioCheckApi.get('/apps/audiocheck/api/scan').then((r) => {
					const s = r.scan;
					let text = t('audiocheck', 'Status: {status} — {count} tracks', { status: s.status, count: s.tracksTotal });
					if (s.lastError) {
						text += ' — ' + t('audiocheck', 'Last error: {error}', { error: s.lastError });
					}
					status.textContent = text;
					cronCallout.hidden = s.backgroundCron !== false;
				}).catch((e) => {
					status.textContent = e.message || t('audiocheck', 'Request failed.');
				});
				AudioCheckApi.get('/apps/audiocheck/api/libraries').then((r) => {
					body.textContent = '';
					body.appendChild(scanPanel);
					const list = r.libraries || [];
					if (!list.length) {
						body.appendChild(C.emptyState(
							t('audiocheck', 'No folders yet'),
							t('audiocheck', 'Choose a folder from your files to index audio. Use Add folder above to get started.'),
							{ icon: 'folder' },
						));
					} else {
						const libs = C.el('div', { className: 'ac-library-list' });
						list.forEach((lib) => {
							const row = C.el('article', { className: 'ac-card ac-library-row' + (!lib.enabled ? ' ac-library-row--disabled' : '') });
							const meta = C.el('div');
							meta.appendChild(C.el('h3', { className: 'ac-card__title', text: lib.folderPath || '/' }));
							if (!lib.enabled) {
								meta.appendChild(C.el('p', {
									className: 'ac-field__hint ac-library-row__warn',
									text: t('audiocheck', 'This folder is unavailable. Remove it or restore access in Files.'),
								}));
							}
							if (lib.rootFileId) {
								meta.appendChild(C.el('p', {
									className: 'ac-card__subtitle',
									text: t('audiocheck', 'Folder ID: {id}', { id: String(lib.rootFileId) }),
								}));
							}
							row.appendChild(meta);
							const rm = C.el('button', {
								type: 'button',
								className: 'ac-btn',
								text: t('audiocheck', 'Remove'),
								onClick: () => {
									AudioCheckApi.del('/apps/audiocheck/api/libraries/{id}', null, { params: { id: lib.id } })
										.then(refresh)
										.catch((e) => AudioCheckMessaging.toast(e.message, 'error'));
								},
							});
							row.appendChild(rm);
							libs.appendChild(row);
						});
						body.appendChild(C.section(t('audiocheck', 'Folders'), libs));
					}
					body.appendChild(C.section(t('audiocheck', 'Supported formats'), formats));
				}).catch((e) => {
					body.textContent = '';
					body.appendChild(scanPanel);
					body.appendChild(C.el('p', { className: 'ac-field__hint', text: e.message || t('audiocheck', 'Request failed.') }));
				});
			}

			frag.appendChild(body);
			refresh();
			return frag;
		},
	});
})();
