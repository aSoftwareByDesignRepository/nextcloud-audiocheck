(function () {
	'use strict';
	const C = AudioCheckComponents;

	function friendlyFolderPath(path) {
		if (!path) return '/';
		const parts = String(path).split('/').filter(Boolean);
		if (parts.length >= 2 && parts[0] === 'files') {
			return '/' + parts.slice(1).join('/');
		}
		return path;
	}

	function folderDisplayName(path) {
		const normalized = friendlyFolderPath(path);
		const parts = normalized.split('/').filter(Boolean);
		if (!parts.length) return t('audiocheck', 'Files home');
		if (parts.length === 1) return parts[0];
		return parts.join(' / ');
	}

	function libraryCardModifier(kind) {
		const k = kind || 'auto';
		if (k === 'music') return 'music';
		if (k === 'audiobook') return 'audiobook';
		return 'auto';
	}

	function scanStatusLabel(scan) {
		if (!scan) return '…';
		let text = t('audiocheck', 'Status: {status} — {count} tracks indexed', {
			status: scan.status,
			count: scan.tracksTotal,
		});
		if (scan.lastError) {
			text += ' — ' + t('audiocheck', 'Last error: {error}', { error: scan.lastError });
		}
		return text;
	}

	function scanBadgeClass(status) {
		if (status === 'running' || status === 'queued') return 'ac-badge ac-badge--active';
		if (status === 'idle') return 'ac-badge ac-badge--ok';
		return 'ac-badge';
	}

	const CONTENT_KINDS = ['auto', 'music', 'audiobook'];

	function contentKindLabel(kind) {
		const k = kind || 'auto';
		if (k === 'music') return t('audiocheck', 'Music');
		if (k === 'audiobook') return t('audiocheck', 'Audiobooks');
		return t('audiocheck', 'Auto-detect');
	}

	function contentKindHint(kind) {
		const k = kind || 'auto';
		if (k === 'music') return t('audiocheck', 'All audio in this folder is treated as music.');
		if (k === 'audiobook') return t('audiocheck', 'All audio in this folder is treated as audiobooks (including MP3 chapters).');
		return t('audiocheck', 'AudioCheck decides from file type, length, and genre.');
	}

	function contentKindBadgeClass(kind) {
		const k = kind || 'auto';
		if (k === 'music') return 'ac-badge ac-badge--music';
		if (k === 'audiobook') return 'ac-badge ac-badge--audiobook';
		return 'ac-badge ac-badge--auto';
	}

	function pickContentKindModal() {
		return new Promise((resolve) => {
			let selected = 'auto';
			const selectId = 'ac-content-kind-select-' + Math.random().toString(36).slice(2);
			const hintId = 'ac-content-kind-hint-' + Math.random().toString(36).slice(2);
			const field = C.el('div', { className: 'ac-field ac-library-kind-field' });
			field.appendChild(C.el('label', {
				attrs: { for: selectId },
				text: t('audiocheck', 'Content type'),
			}));
			const select = C.el('select', {
				id: selectId,
				className: 'ac-input',
				attrs: { 'aria-describedby': hintId, autofocus: true },
			});
			CONTENT_KINDS.forEach((kind) => {
				select.appendChild(C.el('option', { attrs: { value: kind }, text: contentKindLabel(kind) }));
			});
			const hint = C.el('p', { id: hintId, className: 'ac-field__hint', text: contentKindHint('auto') });
			select.addEventListener('change', () => {
				selected = select.value;
				hint.textContent = contentKindHint(selected);
			});
			field.appendChild(select);
			field.appendChild(hint);
			const intro = C.el('p', {
				className: 'ac-field__hint ac-content-kind-picker__intro',
				text: t('audiocheck', 'Tell AudioCheck what lives in this folder. You can change this later.'),
			});
			C.openModal({
				title: t('audiocheck', 'What is in this folder?'),
				primaryLabel: t('audiocheck', 'Add folder'),
				dialogClass: 'ac-modal__dialog--narrow',
				render() {
					return C.el('div', { className: 'ac-content-kind-picker' }, [intro, field]);
				},
				onSubmit: async () => {
					resolve(selected);
					return true;
				},
				onCancel: () => resolve(null),
			});
		});
	}

	function resolveContentKind(presetKind) {
		if (presetKind && CONTENT_KINDS.includes(presetKind)) {
			return Promise.resolve(presetKind);
		}
		return pickContentKindModal();
	}

	function updateLibraryField(lib, body, handlers, messages) {
		const onRefresh = handlers && handlers.refresh;
		const scanBtn = handlers && handlers.scanBtn;
		return AudioCheckApi.put('/apps/audiocheck/api/libraries/{id}', body, { params: { id: lib.id } })
			.then((r) => {
				if (r.rescanRecommended) {
					AudioCheckMessaging.toast(messages.rescan);
					if (typeof onRefresh === 'function') onRefresh();
					return triggerScanFlow(scanBtn, onRefresh);
				}
				AudioCheckMessaging.toast(messages.ok);
				if (typeof onRefresh === 'function') onRefresh();
				return r;
			});
	}

	function updateLibraryContentKind(lib, contentKind, handlers) {
		return updateLibraryField(lib, { contentKind }, handlers, {
			ok: t('audiocheck', 'Content type updated.'),
			rescan: t('audiocheck', 'Content type updated. Re-scanning to auto-detect tracks…'),
		});
	}

	function updateLibraryScope(lib, includeSubfolders, handlers) {
		return updateLibraryField(lib, { includeSubfolders }, handlers, {
			ok: t('audiocheck', 'Scope updated.'),
			rescan: t('audiocheck', 'Scope updated. Re-scanning your folders…'),
		});
	}

	function pollScanUntilIdle(onUpdate, onDone) {
		let attempts = 0;
		const maxAttempts = 90;
		const tick = () => {
			AudioCheckApi.get('/apps/audiocheck/api/scan').then((r) => {
				const scan = r.scan;
				if (typeof onUpdate === 'function') onUpdate(scan);
				if (scan.status === 'running' || scan.status === 'queued') {
					if (attempts++ < maxAttempts) {
						window.setTimeout(tick, 1000);
						return;
					}
				}
				if (typeof onDone === 'function') onDone(scan);
			}).catch((e) => {
				if (typeof onDone === 'function') onDone(null, e);
			});
		};
		tick();
	}

	function triggerScanFlow(scanBtn, refresh) {
		if (scanBtn) scanBtn.disabled = true;
		return AudioCheckApi.post('/apps/audiocheck/api/scan').then((r) => {
			const start = r.scan;
			if (typeof refresh === 'function') refresh(start);
			if (start.status === 'running' || start.status === 'queued') {
				return new Promise((resolve) => {
					pollScanUntilIdle(
						(scan) => { if (typeof refresh === 'function') refresh(scan); },
						(scan) => resolve(scan),
					);
				});
			}
			return start;
		}).finally(() => {
			if (scanBtn) scanBtn.disabled = false;
		});
	}

	function addLibraryFolder(handlers, presetKind) {
		const onRefresh = handlers && handlers.refresh;
		const scanBtn = handlers && handlers.scanBtn;
		const setBusy = handlers && handlers.setAddBusy;
		const setStatus = handlers && handlers.setAddStatus;
		if (typeof setStatus === 'function') {
			setStatus(t('audiocheck', 'Opening folder picker…'));
		}
		return AudioCheckFolderPicker.pickFolder().then((pick) => {
			if (!pick || (!pick.fileId && !pick.pickedPath)) {
				if (typeof setStatus === 'function') setStatus('');
				AudioCheckMessaging.toast(t('audiocheck', 'No folder was selected.'), 'warning');
				return null;
			}
			return resolveContentKind(presetKind).then((contentKind) => {
				if (!contentKind) {
					if (typeof setStatus === 'function') setStatus('');
					return null;
				}
				if (typeof setStatus === 'function') {
					setStatus(t('audiocheck', 'Saving folder…'));
				}
				const prefs = window.AudioCheckUserPrefs || {};
				const body = {
					includeSubfolders: prefs.scanSubfolders !== false,
					contentKind,
				};
				if (pick.fileId) body.rootFileId = pick.fileId;
				if (pick.pickedPath) body.folderPath = pick.pickedPath;
				return AudioCheckApi.post('/apps/audiocheck/api/libraries', body).then((r) => ({ r, contentKind, pick }));
			});
		}).then((payload) => {
			if (!payload || !payload.r || !payload.r.library) {
				if (typeof setStatus === 'function') setStatus('');
				return payload;
			}
			const lib = payload.r.library;
			if (typeof handlers.setHighlightLibraryId === 'function') {
				handlers.setHighlightLibraryId(lib.id);
			}
			if (payload.r.alreadyExisted) {
				AudioCheckMessaging.toast(t('audiocheck', 'This folder was already added. Content type updated to {kind}.', {
					kind: contentKindLabel(lib.contentKind),
				}));
			} else {
				AudioCheckMessaging.toast(t('audiocheck', '{kind} folder added. Scanning your audio…', {
					kind: contentKindLabel(payload.contentKind),
				}));
			}
			if (typeof onRefresh === 'function') onRefresh();
			const needsScan = !payload.r.alreadyExisted || payload.r.rescanRecommended;
			if (!needsScan) {
				if (typeof setStatus === 'function') setStatus('');
				return payload.r;
			}
			if (typeof setStatus === 'function') {
				setStatus(t('audiocheck', 'Scanning your audio…'));
			}
			return triggerScanFlow(scanBtn, onRefresh).then((scan) => {
				if (typeof setStatus === 'function') setStatus('');
				return scan;
			});
		}).finally(() => {
			if (typeof setBusy === 'function') setBusy(false);
		});
	}

	function runAddFolder(handlers, presetKind) {
		const setBusy = handlers && handlers.setAddBusy;
		if (typeof setBusy === 'function') setBusy(true);
		return addLibraryFolder(handlers, presetKind).catch((e) => {
			if (AudioCheckFolderPicker.isPickerCancelled(e)) return;
			AudioCheckMessaging.toast(e.message, 'error');
		});
	}

	function renderAddChoices(host, handlers) {
		if (!host) return;
		host.replaceChildren();
		const grid = C.el('div', {
			className: 'ac-library-add__grid',
			attrs: { role: 'group', 'aria-label': t('audiocheck', 'Add a folder from Files') },
		});
		const choices = [
			{
				kind: 'music',
				mod: 'music',
				title: t('audiocheck', 'Add music folder'),
				desc: t('audiocheck', 'Albums, singles, and playlists from a folder in Files.'),
			},
			{
				kind: 'audiobook',
				mod: 'audiobook',
				title: t('audiocheck', 'Add audiobook folder'),
				desc: t('audiocheck', 'Books and chapter folders (MP3, M4B, and more).'),
			},
			{
				kind: 'auto',
				mod: 'auto',
				title: t('audiocheck', 'Add folder (auto-detect)'),
				desc: t('audiocheck', 'Let AudioCheck guess from file type, length, and genre.'),
			},
		];
		choices.forEach((choice) => {
			const btn = C.el('button', {
				type: 'button',
				className: 'ac-library-add__card ac-library-add__card--' + choice.mod,
				attrs: { 'data-ac-add-kind': choice.kind },
				onClick: () => runAddFolder(handlers, choice.kind),
			});
			btn.appendChild(C.el('span', { className: 'ac-library-add__card-title', text: choice.title }));
			btn.appendChild(C.el('span', { className: 'ac-library-add__card-desc', text: choice.desc }));
			grid.appendChild(btn);
		});
		host.appendChild(grid);
	}

	function setAddButtonsBusy(host, busy) {
		if (!host) return;
		host.querySelectorAll('[data-ac-add-kind]').forEach((btn) => {
			btn.disabled = !!busy;
		});
	}

	function renderSummary(summaryEl, libraries, scan) {
		if (!summaryEl) return;
		summaryEl.replaceChildren();
		const folderCount = libraries.length;
		const trackCount = scan ? scan.tracksTotal : 0;
		const musicFolders = libraries.filter((l) => (l.contentKind || 'auto') === 'music').length;
		const audiobookFolders = libraries.filter((l) => (l.contentKind || 'auto') === 'audiobook').length;
		const grid = C.el('dl', { className: 'ac-library-summary__grid' });
		const addStat = (label, value) => {
			const row = C.el('div', { className: 'ac-library-summary__item' });
			row.appendChild(C.el('dt', { className: 'ac-library-summary__label', text: label }));
			row.appendChild(C.el('dd', { className: 'ac-library-summary__value', text: String(value) }));
			grid.appendChild(row);
		};
		addStat(t('audiocheck', 'Folders'), folderCount);
		if (musicFolders > 0) addStat(t('audiocheck', 'Music folders'), musicFolders);
		if (audiobookFolders > 0) addStat(t('audiocheck', 'Audiobook folders'), audiobookFolders);
		addStat(t('audiocheck', 'Tracks indexed'), trackCount);
		const statusRow = C.el('div', { className: 'ac-library-summary__item ac-library-summary__item--status' });
		statusRow.appendChild(C.el('dt', { className: 'ac-library-summary__label', text: t('audiocheck', 'Scan') }));
		const dd = C.el('dd', { className: 'ac-library-summary__value' });
		dd.appendChild(C.el('span', {
			className: scanBadgeClass(scan && scan.status),
			text: scan ? scan.status : '…',
		}));
		statusRow.appendChild(dd);
		grid.appendChild(statusRow);
		summaryEl.appendChild(grid);

		if (folderCount > 0 && trackCount === 0 && scan && scan.status === 'idle') {
			summaryEl.appendChild(C.el('p', {
				className: 'ac-callout ac-library-summary__hint',
				attrs: { role: 'status' },
				text: t('audiocheck', 'Your folder is saved. Tap Scan now if tracks do not appear after a moment.'),
			}));
		} else if (folderCount > 0 && trackCount > 0) {
			const actions = C.el('div', { className: 'ac-toolbar ac-toolbar--compact ac-toolbar--wrap' });
			actions.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Open Music'),
				onClick: () => AudioCheckRouter.navigate('music', {}, true),
			}));
			actions.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Audiobooks'),
				onClick: () => AudioCheckRouter.navigate('audiobooks', {}, true),
			}));
			actions.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Browse'),
				onClick: () => AudioCheckRouter.navigate('browse', {}, true),
			}));
			summaryEl.appendChild(actions);
		}
	}

	AudioCheckRouter.register('library', {
		render() {
			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-library-page' });

			const summaryEl = C.el('div', {
				id: 'ac-library-summary',
				className: 'ac-library-summary ac-card',
				attrs: { 'aria-live': 'polite' },
			});
			const status = C.el('p', { id: 'ac-scan-status', className: 'ac-scan-status', text: '…' });
			const scanHint = C.el('p', {
				id: 'ac-scan-hint',
				className: 'ac-field__hint ac-library-scan__hint',
				attrs: { hidden: true },
				text: t('audiocheck', 'Add a folder before scanning.'),
			});
			const cronCallout = C.el('p', {
				id: 'ac-cron-callout',
				className: 'ac-callout',
				attrs: { role: 'status', hidden: true },
				text: t('audiocheck', 'Background cron is not enabled on this server. Use Scan now to refresh your library, or ask an administrator to enable system cron in Nextcloud settings.'),
			});
			const scanPanel = C.el('div', { className: 'ac-library-scan' }, [status, scanHint, cronCallout]);

			let scanBtn;
			let addChoicesHost;
			let addStatusEl;
			let lastLibraries = [];
			let lastScan = null;
			let highlightLibraryId = null;

			const handlers = {
				get scanBtn() { return scanBtn; },
				refresh,
				setAddBusy(busy) { setAddButtonsBusy(addChoicesHost, busy); },
				setAddStatus(text) {
					if (!addStatusEl) return;
					addStatusEl.textContent = text || '';
					addStatusEl.hidden = !text;
				},
				setHighlightLibraryId(id) { highlightLibraryId = id; },
			};

			function renderLibraryRow(lib) {
				const kindMod = libraryCardModifier(lib.contentKind);
				const pathLabel = friendlyFolderPath(lib.folderPath);
				const trackCount = typeof lib.trackCount === 'number' ? lib.trackCount : 0;
				const row = C.el('article', {
					className: 'ac-library-card ac-library-card--' + kindMod
						+ (!lib.enabled ? ' ac-library-card--disabled' : '')
						+ (highlightLibraryId === lib.id ? ' ac-library-card--highlight' : ''),
					attrs: { role: 'listitem', 'data-library-id': String(lib.id) },
				});

				const body = C.el('div', { className: 'ac-library-card__row' });

				const identity = C.el('div', { className: 'ac-library-card__identity' });
				identity.appendChild(C.kindIcon(kindMod, 'ac-library-card__icon'));
				const titles = C.el('div', { className: 'ac-library-card__titles' });
				titles.appendChild(C.el('h3', {
					className: 'ac-library-card__name',
					text: folderDisplayName(lib.folderPath),
				}));
				titles.appendChild(C.el('p', {
					className: 'ac-library-card__path',
					text: pathLabel,
				}));
				identity.appendChild(titles);
				identity.appendChild(C.el('span', {
					className: 'ac-library-card__kind ' + contentKindBadgeClass(lib.contentKind),
					text: contentKindLabel(lib.contentKind),
				}));
				body.appendChild(identity);

				const stats = C.el('dl', { className: 'ac-library-card__stats' });
				const addStat = (label, value, mod) => {
					const item = C.el('div', { className: 'ac-library-card__stat' + (mod ? ' ac-library-card__stat--' + mod : '') });
					item.appendChild(C.el('dt', { className: 'ac-library-card__stat-label', text: label }));
					item.appendChild(C.el('dd', { className: 'ac-library-card__stat-value', text: value }));
					stats.appendChild(item);
				};
				addStat(
					t('audiocheck', 'Tracks'),
					trackCount > 0
						? String(trackCount)
						: t('audiocheck', 'No tracks yet'),
					trackCount > 0 ? 'ok' : 'empty',
				);
				body.appendChild(stats);

				const actions = C.el('div', { className: 'ac-library-card__actions' });
				const kindField = C.el('div', { className: 'ac-library-card__field' });
				const kindSelectId = 'ac-library-kind-' + lib.id;
				kindField.appendChild(C.el('label', {
					attrs: { for: kindSelectId },
					text: t('audiocheck', 'Content type'),
				}));
				const kindSelect = C.el('select', {
					id: kindSelectId,
					className: 'ac-input ac-library-card__select',
					attrs: { 'aria-label': t('audiocheck', 'Content type for {folder}', { folder: pathLabel }) },
				});
				CONTENT_KINDS.forEach((kind) => {
					kindSelect.appendChild(C.el('option', {
						attrs: { value: kind, selected: (lib.contentKind || 'auto') === kind ? true : undefined },
						text: contentKindLabel(kind),
					}));
				});
				let kindBusy = false;
				kindSelect.addEventListener('change', () => {
					const next = kindSelect.value;
					const prev = lib.contentKind || 'auto';
					if (next === prev || kindBusy) {
						kindSelect.value = prev;
						return;
					}
					kindBusy = true;
					kindSelect.disabled = true;
					updateLibraryContentKind(lib, next, handlers).catch((e) => {
						kindSelect.value = prev;
						AudioCheckMessaging.toast(e.message, 'error');
					}).finally(() => {
						kindBusy = false;
						kindSelect.disabled = false;
					});
				});
				kindField.appendChild(kindSelect);
				actions.appendChild(kindField);

				const scopeField = C.el('div', { className: 'ac-library-card__field' });
				const scopeSelectId = 'ac-library-scope-' + lib.id;
				scopeField.appendChild(C.el('label', {
					attrs: { for: scopeSelectId },
					text: t('audiocheck', 'Scope'),
				}));
				const scopeSelect = C.el('select', {
					id: scopeSelectId,
					className: 'ac-input ac-library-card__select',
					attrs: { 'aria-label': t('audiocheck', 'Scope for {folder}', { folder: pathLabel }) },
				});
				[
					{ value: '1', label: t('audiocheck', 'Includes subfolders'), selected: lib.includeSubfolders !== false },
					{ value: '0', label: t('audiocheck', 'This folder only'), selected: lib.includeSubfolders === false },
				].forEach((opt) => {
					scopeSelect.appendChild(C.el('option', {
						attrs: { value: opt.value, selected: opt.selected ? true : undefined },
						text: opt.label,
					}));
				});
				let scopeBusy = false;
				scopeSelect.addEventListener('change', () => {
					const next = scopeSelect.value === '1';
					const prev = lib.includeSubfolders !== false;
					if (next === prev || scopeBusy) {
						scopeSelect.value = prev ? '1' : '0';
						return;
					}
					scopeBusy = true;
					scopeSelect.disabled = true;
					updateLibraryScope(lib, next, handlers).catch((e) => {
						scopeSelect.value = prev ? '1' : '0';
						AudioCheckMessaging.toast(e.message, 'error');
					}).finally(() => {
						scopeBusy = false;
						scopeSelect.disabled = false;
					});
				});
				scopeField.appendChild(scopeSelect);
				actions.appendChild(scopeField);

				actions.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--danger ac-library-card__remove',
					text: t('audiocheck', 'Remove'),
					onClick: () => {
						C.confirmDialog({
							title: t('audiocheck', 'Remove folder?'),
							message: t('audiocheck', 'AudioCheck will stop scanning this folder. Your files are not deleted.'),
							confirmLabel: t('audiocheck', 'Remove'),
							danger: true,
							onConfirm: async () => {
								await AudioCheckApi.del('/apps/audiocheck/api/libraries/{id}', null, { params: { id: lib.id } });
								AudioCheckMessaging.toast(t('audiocheck', 'Folder removed.'));
								refresh();
							},
						});
					},
				}));
				body.appendChild(actions);
				row.appendChild(body);

				if (!lib.enabled) {
					row.appendChild(C.el('p', {
						className: 'ac-library-card__message ac-library-card__warn',
						attrs: { role: 'alert' },
						text: t('audiocheck', 'This folder is unavailable. Remove it or restore access in Files.'),
					}));
				} else if (trackCount === 0) {
					row.appendChild(C.el('p', {
						className: 'ac-library-card__message ac-library-card__hint',
						attrs: { role: 'status' },
						text: t('audiocheck', 'Tap Scan now above if audio does not appear after a moment.'),
					}));
				}

				return row;
			}

			function renderFolders(list) {
				const foldersSection = body.querySelector('#ac-library-folders-section');
				if (!foldersSection) return;
				foldersSection.replaceChildren();
				if (!list.length) {
					foldersSection.appendChild(C.emptyState(
						t('audiocheck', 'No folders yet'),
						t('audiocheck', 'Use the buttons below to add a music or audiobook folder from Files.'),
						{ variant: 'section', icon: 'folder' },
					));
					return;
				}
				const libs = C.el('div', { className: 'ac-library-list', attrs: { role: 'list' } });
				list.forEach((lib) => libs.appendChild(renderLibraryRow(lib)));
				foldersSection.appendChild(libs);
				if (highlightLibraryId) {
					const target = foldersSection.querySelector('[data-library-id="' + highlightLibraryId + '"]');
					if (target) {
						window.requestAnimationFrame(() => {
							target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
						});
					}
					window.setTimeout(() => {
						highlightLibraryId = null;
						list.forEach((lib) => {
							const row = foldersSection.querySelector('[data-library-id="' + lib.id + '"]');
							if (row) row.classList.remove('ac-library-card--highlight');
						});
					}, 4000);
				}
				if (list.length > 1) {
					foldersSection.appendChild(C.el('p', {
						className: 'ac-field__hint ac-library-overlap-hint',
						attrs: { role: 'note' },
						text: t('audiocheck', 'Tip: use separate roots for music and audiobooks. Avoid nested folders that overlap (for example /Music and /Music/Albums).'),
					}));
				}
			}

			function updateScanControls() {
				const noFolders = lastLibraries.length === 0;
				const scanning = lastScan && (lastScan.status === 'running' || lastScan.status === 'queued');
				scanBtn.disabled = noFolders || scanning;
				scanBtn.setAttribute('aria-disabled', (noFolders || scanning) ? 'true' : 'false');
				scanHint.hidden = !noFolders;
			}

			function refresh(scanHint) {
				if (scanHint) {
					lastScan = scanHint;
					status.textContent = scanStatusLabel(scanHint);
					renderSummary(summaryEl, lastLibraries, lastScan);
					updateScanControls();
				}
				AudioCheckApi.get('/apps/audiocheck/api/scan').then((r) => {
					lastScan = r.scan;
					status.textContent = scanStatusLabel(lastScan);
					cronCallout.hidden = lastScan.backgroundCron !== false;
					renderSummary(summaryEl, lastLibraries, lastScan);
					updateScanControls();
				}).catch((e) => {
					status.textContent = e.message || t('audiocheck', 'Request failed.');
				});
				AudioCheckApi.get('/apps/audiocheck/api/libraries').then((r) => {
					lastLibraries = r.libraries || [];
					renderFolders(lastLibraries);
					renderSummary(summaryEl, lastLibraries, lastScan);
					updateScanControls();
				}).catch((e) => {
					const foldersSection = body.querySelector('#ac-library-folders-section');
					if (foldersSection) {
						foldersSection.replaceChildren();
						foldersSection.appendChild(C.el('p', {
							className: 'ac-field__hint',
							attrs: { role: 'alert' },
							text: e.message || t('audiocheck', 'Request failed.'),
						}));
					}
				});
			}

			scanBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Scan now'),
				onClick: () => {
					triggerScanFlow(scanBtn, refresh).catch((e) => {
						AudioCheckMessaging.toast(e.message, 'error');
					});
				},
			});

			frag.appendChild(C.pageHeader(
				t('audiocheck', 'Library'),
				t('audiocheck', 'Your audio stays in Files. Add folders here so AudioCheck knows what to scan.'),
				scanBtn,
			));

			body.appendChild(summaryEl);

			const foldersWrap = C.el('section', {
				className: 'ac-section ac-library-folders-section',
				attrs: { 'aria-labelledby': 'ac-library-folders-heading' },
			});
			foldersWrap.appendChild(C.el('h2', {
				id: 'ac-library-folders-heading',
				className: 'ac-section__title',
				text: t('audiocheck', 'Your folders'),
			}));
			foldersWrap.appendChild(C.el('p', {
				className: 'ac-section__lead',
				text: t('audiocheck', 'Every folder you add appears here. Change the content type anytime.'),
			}));
			foldersWrap.appendChild(C.el('div', { id: 'ac-library-folders-section' }));
			body.appendChild(foldersWrap);

			const addWrap = C.el('section', {
				className: 'ac-section ac-library-add-section',
				attrs: { 'aria-labelledby': 'ac-library-add-heading' },
			});
			addWrap.appendChild(C.el('h2', {
				id: 'ac-library-add-heading',
				className: 'ac-section__title',
				text: t('audiocheck', 'Add from Files'),
			}));
			addWrap.appendChild(C.el('p', {
				className: 'ac-section__lead',
				text: t('audiocheck', 'Pick a folder in the Files app. Nothing is copied — AudioCheck only indexes what is already there.'),
			}));
			addWrap.appendChild(C.el('p', {
				className: 'ac-callout ac-callout--info ac-library-add__callout',
				attrs: { role: 'note' },
				text: t('audiocheck', 'Music and audiobooks are separate: add one folder for albums, another for books (or chapter folders like CD1 and CD2).'),
			}));
			addStatusEl = C.el('p', {
				id: 'ac-library-add-status',
				className: 'ac-library-add__status',
				attrs: { role: 'status', 'aria-live': 'polite', hidden: true },
			});
			addWrap.appendChild(addStatusEl);
			addChoicesHost = C.el('div', { id: 'ac-library-add-choices' });
			addWrap.appendChild(addChoicesHost);
			body.appendChild(addWrap);
			renderAddChoices(addChoicesHost, handlers);

			body.appendChild(C.section(t('audiocheck', 'Scan status'), scanPanel));

			const steps = C.el('ol', { className: 'ac-steps ac-library-steps' });
			[
				t('audiocheck', 'Add music folder or Add audiobook folder — pick the matching folder in Files.'),
				t('audiocheck', 'Scan now — AudioCheck indexes audio inside your folders.'),
				t('audiocheck', 'Open Music or Audiobooks — listen to albums, playlists, and chapters.'),
			].forEach((text) => steps.appendChild(C.el('li', { text })));
			body.appendChild(C.section(t('audiocheck', 'How it works'), steps));

			body.appendChild(C.section(
				t('audiocheck', 'Supported formats'),
				C.el('p', {
					className: 'ac-field__hint',
					text: t('audiocheck', 'Usually plays in the browser: MP3, M4A, M4B, AAC, OGG, Opus, WAV. FLAC, WMA, and AIFF may need another app or browser.'),
				}),
			));

			frag.appendChild(body);
			refresh();
			return frag;
		},
	});
})();
