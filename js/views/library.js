(function () {
	'use strict';
	const C = AudioCheckComponents;

	let libraryViewGen = 0;

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

	function isScanning(scan) {
		return !!scan && (scan.status === 'running' || scan.status === 'queued');
	}

	function foldersLabel(count) {
		const n = Math.max(0, parseInt(count, 10) || 0);
		return n === 1
			? t('audiocheck', '1 folder')
			: t('audiocheck', '{count} folders', { count: String(n) });
	}

	/**
	 * Friendly, single-sentence summary of the library state.
	 * @returns {{ text: string, tone: string }}
	 */
	function librarySummary(libraries, scan) {
		const folders = libraries.length;
		const tracks = scan ? (scan.tracksTotal || 0) : 0;
		if (folders === 0) {
			return { text: t('audiocheck', 'No folders yet. Add a folder to get started.'), tone: 'muted' };
		}
		if (isScanning(scan)) {
			return { text: t('audiocheck', 'Scanning your folders…'), tone: 'active' };
		}
		if (scan && (scan.status === 'failed' || scan.status === 'error')) {
			return { text: t('audiocheck', 'Scan failed. Press Scan now to try again.'), tone: 'warn' };
		}
		if (tracks === 0) {
			return { text: t('audiocheck', 'No audio found yet. Press Scan now to look for audio.'), tone: 'muted' };
		}
		return {
			text: t('audiocheck', 'Ready to play — {tracks} in {folders}.', {
				tracks: AudioCheckTime.tracksLabel(tracks),
				folders: foldersLabel(folders),
			}),
			tone: 'ok',
		};
	}

	const CONTENT_KINDS = ['auto', 'music', 'audiobook'];

	function contentKindLabel(kind) {
		const k = kind || 'auto';
		if (k === 'music') return t('audiocheck', 'Music');
		if (k === 'audiobook') return t('audiocheck', 'Audiobooks');
		return t('audiocheck', 'Auto-detect');
	}

	/**
	 * Infer Music / Audiobooks from common folder names so "Add a folder" needs no extra step.
	 * @param {string} path
	 * @returns {'auto'|'music'|'audiobook'}
	 */
	function guessContentKindFromPath(path) {
		const hay = (friendlyFolderPath(path) + ' ' + folderDisplayName(path)).toLowerCase()
			.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
		if (/\b(audiobooks?|hoerbuecher|horbuch(?:er)?|livre\s*audio)\b/.test(hay)) {
			return 'audiobook';
		}
		if (/\b(music|musik|musica|musique|songs?)\b/.test(hay)) {
			return 'music';
		}
		return 'auto';
	}

	function contentKindBadgeClass(kind) {
		const k = kind || 'auto';
		if (k === 'music') return 'ac-badge ac-badge--music';
		if (k === 'audiobook') return 'ac-badge ac-badge--audiobook';
		return 'ac-badge ac-badge--auto';
	}

	function resolveContentKind(presetKind, pickedPath) {
		if (presetKind && CONTENT_KINDS.includes(presetKind)) {
			return presetKind;
		}
		return guessContentKindFromPath(pickedPath || '');
	}

	function updateLibraryField(lib, body, handlers, messages) {
		const onRefresh = handlers && handlers.refresh;
		const scanButtons = handlers && handlers.scanButtons ? handlers.scanButtons : [];
		return AudioCheckApi.put('/apps/audiocheck/api/libraries/{id}', body, { params: { id: lib.id } })
			.then((r) => {
				if (r.rescanRecommended) {
					AudioCheckMessaging.toast(messages.rescan);
					if (typeof onRefresh === 'function') onRefresh();
					return triggerScanFlow(scanButtons, onRefresh, handlers && handlers.alive);
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

	function pollScanUntilIdle(onUpdate, onDone, alive) {
		let attempts = 0;
		const maxAttempts = 90;
		let lastScan = null;
		const tick = () => {
			if (alive && !alive()) return;
			AudioCheckApi.fetchScanStatus(lastScan).then((scan) => {
				if (alive && !alive()) return;
				lastScan = scan;
				if (typeof onUpdate === 'function') onUpdate(scan);
				if (isScanning(scan)) {
					if (attempts++ < maxAttempts) {
						window.setTimeout(tick, 1000);
						return;
					}
				}
				if (typeof onDone === 'function') onDone(scan);
			}).catch((e) => {
				if (alive && !alive()) return;
				if (typeof onDone === 'function') onDone(null, e);
			});
		};
		tick();
	}

	function triggerScanFlow(scanButtons, refresh, alive) {
		const buttons = (Array.isArray(scanButtons) ? scanButtons : [scanButtons]).filter(Boolean);
		buttons.forEach((btn) => { btn.disabled = true; });
		return AudioCheckApi.post('/apps/audiocheck/api/scan').then((r) => {
			if (alive && !alive()) return r.scan;
			const start = r.scan;
			if (typeof refresh === 'function') refresh(start);
			if (isScanning(start)) {
				return new Promise((resolve) => {
					pollScanUntilIdle(
						(scan) => { if (typeof refresh === 'function') refresh(scan); },
						(scan) => resolve(scan),
						alive,
					);
				});
			}
			return start;
		}).catch((e) => {
			if (!alive || alive()) {
				buttons.forEach((btn) => { btn.disabled = false; });
			}
			throw e;
		});
	}

	function addLibraryFolder(handlers, presetKind) {
		const onRefresh = handlers && handlers.refresh;
		const scanButtons = handlers && handlers.scanButtons ? handlers.scanButtons : [];
		const setBusy = handlers && handlers.setAddBusy;
		const setStatus = handlers && handlers.setAddStatus;
		const alive = handlers && handlers.alive;
		if (typeof setStatus === 'function') {
			setStatus(t('audiocheck', 'Opening folder picker…'));
		}
		return AudioCheckFolderPicker.pickFolder().then((pick) => {
			if (alive && !alive()) return null;
			if (!pick || (!pick.fileId && !pick.pickedPath)) {
				if (typeof setStatus === 'function') setStatus('');
				AudioCheckMessaging.toast(t('audiocheck', 'No folder was selected.'), 'warning');
				return null;
			}
			const contentKind = resolveContentKind(presetKind, pick.pickedPath || '');
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
		}).then((payload) => {
			if (alive && !alive()) return payload;
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
			return triggerScanFlow(scanButtons, onRefresh, alive).then((scan) => {
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

	AudioCheckRouter.register('library', {
		render() {
			const viewGen = ++libraryViewGen;
			const alive = () => viewGen === libraryViewGen && AudioCheckRouter.getCurrentView() === 'library';

			const frag = document.createDocumentFragment();
			const body = C.el('div', { className: 'ac-page-body ac-library-page' });

			let scanBtn = null;
			let addStatusEl = null;
			let listHost = null;
			let summaryEl = null;
			let cronCallout = null;
			let quickLinks = null;
			let foldersCard = null;
			let pollTimer = null;
			let refreshGen = 0;
			let lastLibraries = [];
			let lastScan = null;
			let highlightLibraryId = null;
			let loadError = null;

			const handlers = {
				get scanButtons() { return [scanBtn].filter(Boolean); },
				get scanBtn() { return scanBtn; },
				alive,
				refresh,
				setAddBusy(busy) {
					body.querySelectorAll('.js-ac-add-folder').forEach((btn) => { btn.disabled = !!busy; });
				},
				setAddStatus(text) {
					if (!addStatusEl) return;
					addStatusEl.textContent = text || '';
					addStatusEl.hidden = !text;
				},
				setHighlightLibraryId(id) { highlightLibraryId = id; },
			};

			function makeAddButton(extraClass, label, presetKind) {
				const btn = C.el('button', {
					type: 'button',
					className: 'ac-btn js-ac-add-folder' + (extraClass ? ' ' + extraClass : ''),
					onClick: () => runAddFolder(handlers, presetKind),
				});
				if (window.AudioCheckIcons && AudioCheckIcons.createSvg) {
					btn.appendChild(AudioCheckIcons.createSvg('add'));
				}
				btn.appendChild(document.createTextNode(label || t('audiocheck', 'Add a folder')));
				return btn;
			}

			function clearPoll() {
				if (pollTimer) {
					window.clearTimeout(pollTimer);
					pollTimer = null;
				}
			}

			function schedulePoll() {
				clearPoll();
				if (!alive() || !isScanning(lastScan)) return;
				pollTimer = window.setTimeout(() => refresh(), 1000);
			}

			function updateScanControls() {
				const noFolders = lastLibraries.length === 0;
				const tracks = lastScan ? (lastScan.tracksTotal || 0) : 0;
				const scanning = isScanning(lastScan);
				const blocked = noFolders || scanning;
				if (scanBtn) {
					scanBtn.disabled = blocked;
					scanBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
					scanBtn.classList.toggle('ac-btn--primary', !blocked && tracks === 0);
					scanBtn.textContent = scanning ? t('audiocheck', 'Scanning…') : t('audiocheck', 'Scan now');
				}
			}

			function applyState() {
				if (!alive()) return;
				if (foldersCard) {
					foldersCard.setAttribute('aria-busy', isScanning(lastScan) ? 'true' : 'false');
				}
				const summary = loadError
					? { text: loadError, tone: 'warn' }
					: librarySummary(lastLibraries, lastScan);
				if (summaryEl) {
					summaryEl.textContent = summary.text;
					summaryEl.className = 'ac-library-bar__status ac-library-bar__status--' + summary.tone;
					summaryEl.setAttribute('role', summary.tone === 'warn' ? 'alert' : 'status');
				}
				if (cronCallout) {
					cronCallout.hidden = !lastScan || lastScan.backgroundCron !== false;
				}
				if (quickLinks) {
					const tracks = lastScan ? (lastScan.tracksTotal || 0) : 0;
					quickLinks.hidden = !(lastLibraries.length > 0 && tracks > 0);
				}
				updateScanControls();
				schedulePoll();
			}

			function renderKindSegment(lib, handlersRef) {
				const groupId = 'ac-library-kind-' + lib.id;
				const field = C.el('div', {
					className: 'ac-library-card__field ac-library-card__field--kind',
				});
				field.appendChild(C.el('span', {
					className: 'ac-library-card__field-label',
					id: groupId + '-label',
					text: t('audiocheck', 'Content type'),
				}));
				const group = C.el('div', {
					className: 'ac-seg',
					attrs: {
						role: 'radiogroup',
						'aria-labelledby': groupId + '-label',
						'aria-label': t('audiocheck', 'Content type for {folder}', { folder: friendlyFolderPath(lib.folderPath) }),
					},
				});
				let kindBusy = false;
				CONTENT_KINDS.forEach((kind) => {
					const inputId = groupId + '-' + kind;
					const option = C.el('label', {
						className: 'ac-seg__option ac-seg__option--' + libraryCardModifier(kind),
						attrs: { for: inputId },
					});
					const input = C.el('input', {
						type: 'radio',
						id: inputId,
						className: 'ac-seg__input',
						attrs: {
							name: groupId,
							value: kind,
							checked: (lib.contentKind || 'auto') === kind ? true : undefined,
						},
					});
					input.addEventListener('change', () => {
						if (!input.checked || kindBusy) return;
						const next = kind;
						const prev = lib.contentKind || 'auto';
						if (next === prev) return;
						kindBusy = true;
						group.querySelectorAll('input').forEach((el) => { el.disabled = true; });
						updateLibraryContentKind(lib, next, handlersRef).catch((e) => {
							const revert = group.querySelector('input[value="' + prev + '"]');
							if (revert) revert.checked = true;
							AudioCheckMessaging.toast(e.message, 'error');
						}).finally(() => {
							kindBusy = false;
							group.querySelectorAll('input').forEach((el) => { el.disabled = false; });
						});
					});
					option.appendChild(input);
					option.appendChild(C.el('span', { className: 'ac-seg__text', text: contentKindLabel(kind) }));
					group.appendChild(option);
				});
				field.appendChild(group);
				return field;
			}

			function renderScopeToggle(lib, handlersRef) {
				const scopeId = 'ac-library-scope-' + lib.id;
				const hintId = scopeId + '-hint';
				const field = C.el('div', { className: 'ac-library-card__field ac-library-card__field--scope' });
				const row = C.el('div', { className: 'ac-library-card__check-row' });
				const input = C.el('input', {
					type: 'checkbox',
					id: scopeId,
					className: 'ac-library-card__check',
					attrs: {
						checked: lib.includeSubfolders !== false ? true : undefined,
						'aria-describedby': hintId,
					},
				});
				let scopeBusy = false;
				input.addEventListener('change', () => {
					if (scopeBusy) {
						input.checked = lib.includeSubfolders !== false;
						return;
					}
					const next = !!input.checked;
					const prev = lib.includeSubfolders !== false;
					if (next === prev) return;
					scopeBusy = true;
					input.disabled = true;
					updateLibraryScope(lib, next, handlersRef).catch((e) => {
						input.checked = prev;
						AudioCheckMessaging.toast(e.message, 'error');
					}).finally(() => {
						scopeBusy = false;
						input.disabled = false;
					});
				});
				row.appendChild(input);
				row.appendChild(C.el('label', {
					attrs: { for: scopeId },
					text: t('audiocheck', 'Include nested folders'),
				}));
				field.appendChild(row);
				field.appendChild(C.el('p', {
					className: 'ac-field__hint',
					id: hintId,
					text: t('audiocheck', 'Needed for Author / Book / chapter layouts. Turn this off only if every audio file sits directly in this folder.'),
				}));
				return field;
			}

			function renderLibraryRow(lib) {
				const kindMod = libraryCardModifier(lib.contentKind);
				const pathLabel = friendlyFolderPath(lib.folderPath);
				const displayName = folderDisplayName(lib.folderPath);
				const trackCount = typeof lib.trackCount === 'number' ? lib.trackCount : 0;
				const row = C.el('article', {
					className: 'ac-library-card ac-library-card--' + kindMod
						+ (!lib.enabled ? ' ac-library-card--disabled' : '')
						+ (highlightLibraryId === lib.id ? ' ac-library-card--highlight' : ''),
					attrs: { role: 'listitem', 'data-library-id': String(lib.id) },
				});

				const main = C.el('div', { className: 'ac-library-card__main' });
				main.appendChild(C.kindIcon(kindMod, 'ac-library-card__icon'));

				const identity = C.el('div', { className: 'ac-library-card__identity' });
				const titleRow = C.el('div', { className: 'ac-library-card__title-row' });
				titleRow.appendChild(C.el('h3', {
					className: 'ac-library-card__name',
					text: displayName,
				}));
				// Only show the type chip when it adds information (Auto, or name ≠ type).
				const kindLabel = contentKindLabel(lib.contentKind);
				const nameLooksLikeKind = displayName.toLowerCase() === kindLabel.toLowerCase()
					|| displayName.toLowerCase() === 'music'
					|| displayName.toLowerCase() === 'audiobooks'
					|| displayName.toLowerCase() === 'audiobook';
				if ((lib.contentKind || 'auto') === 'auto' || !nameLooksLikeKind) {
					titleRow.appendChild(C.el('span', {
						className: 'ac-library-card__kind ' + contentKindBadgeClass(lib.contentKind),
						text: kindLabel,
					}));
				}
				identity.appendChild(titleRow);
				identity.appendChild(C.el('p', {
					className: 'ac-library-card__path',
					text: pathLabel,
				}));
				main.appendChild(identity);

				const count = C.el('p', {
					className: 'ac-library-card__count' + (trackCount > 0 ? ' ac-library-card__count--ok' : ' ac-library-card__count--empty'),
					attrs: {
						'aria-label': trackCount > 0
							? AudioCheckTime.tracksLabel(trackCount)
							: t('audiocheck', 'No tracks yet'),
					},
				});
				if (trackCount > 0) {
					count.appendChild(C.el('span', { className: 'ac-library-card__count-value', text: String(trackCount) }));
					count.appendChild(C.el('span', { className: 'ac-library-card__count-label', text: t('audiocheck', 'Tracks') }));
				} else {
					count.appendChild(C.el('span', { className: 'ac-library-card__count-label', text: t('audiocheck', 'No tracks yet') }));
				}
				main.appendChild(count);

				main.appendChild(C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--danger ac-library-card__remove',
					text: t('audiocheck', 'Remove'),
					attrs: { 'aria-label': t('audiocheck', 'Remove folder {folder}', { folder: pathLabel }) },
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
				row.appendChild(main);

				const options = C.el('details', { className: 'ac-library-card__options' });
				options.appendChild(C.el('summary', {
					className: 'ac-library-card__options-summary',
					text: t('audiocheck', 'Folder options'),
				}));
				const optionsBody = C.el('div', {
					className: 'ac-library-card__options-body',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Folder settings for {folder}', { folder: pathLabel }) },
				});
				optionsBody.appendChild(renderKindSegment(lib, handlers));
				optionsBody.appendChild(renderScopeToggle(lib, handlers));
				options.appendChild(optionsBody);
				row.appendChild(options);

				if (!lib.enabled) {
					row.appendChild(C.el('p', {
						className: 'ac-library-card__message ac-library-card__warn',
						attrs: { role: 'alert' },
						text: t('audiocheck', 'This folder is unavailable. Remove it or restore access in Files.'),
					}));
				}

				return row;
			}

			function renderEmptyFolders() {
				const empty = C.el('div', {
					className: 'ac-empty ac-empty--section ac-library-empty',
					attrs: { role: 'status' },
				});
				empty.appendChild(C.el('h3', { text: t('audiocheck', 'No folders yet') }));
				empty.appendChild(C.el('p', {
					text: t('audiocheck', 'Pick a folder from Files — scanning starts automatically.'),
				}));
				const actions = C.el('div', {
					className: 'ac-library-empty__actions',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Add a folder') },
				});
				const musicBtn = makeAddButton('ac-btn--primary ac-library-empty__btn', t('audiocheck', 'Add music folder'), 'music');
				const bookBtn = makeAddButton('ac-btn--primary ac-library-empty__btn', t('audiocheck', 'Add audiobook folder'), 'audiobook');
				const autoBtn = makeAddButton('ac-library-empty__btn', t('audiocheck', 'Add folder (auto-detect)'), 'auto');
				actions.appendChild(musicBtn);
				actions.appendChild(bookBtn);
				actions.appendChild(autoBtn);
				empty.appendChild(actions);
				return empty;
			}

			function renderFolders(list) {
				if (!listHost) return;
				listHost.replaceChildren();
				if (loadError && !list.length) {
					listHost.appendChild(C.el('p', {
						className: 'ac-field__hint',
						attrs: { role: 'alert' },
						text: loadError,
					}));
					return;
				}
				if (!list.length) {
					listHost.appendChild(renderEmptyFolders());
					return;
				}
				const libs = C.el('div', { className: 'ac-library-list', attrs: { role: 'list' } });
				list.forEach((lib) => libs.appendChild(renderLibraryRow(lib)));
				listHost.appendChild(libs);

				const addMore = C.el('div', { className: 'ac-library-add-more' });
				addMore.appendChild(makeAddButton('ac-btn--primary', t('audiocheck', 'Add a folder')));
				listHost.appendChild(addMore);

				if (highlightLibraryId) {
					const target = listHost.querySelector('[data-library-id="' + highlightLibraryId + '"]');
					if (target) {
						window.requestAnimationFrame(() => {
							target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
						});
					}
					window.setTimeout(() => {
						if (!alive()) return;
						highlightLibraryId = null;
						list.forEach((lib) => {
							const r = listHost.querySelector('[data-library-id="' + lib.id + '"]');
							if (r) r.classList.remove('ac-library-card--highlight');
						});
					}, 4000);
				}
			}

			function refresh(scanOverride) {
				if (!alive()) return;
				const gen = ++refreshGen;
				if (scanOverride) {
					lastScan = scanOverride;
					applyState();
				}

				Promise.all([
					AudioCheckApi.fetchScanStatus(lastScan),
					AudioCheckApi.get('/apps/audiocheck/api/libraries'),
				]).then(([scan, libRes]) => {
					if (!alive() || gen !== refreshGen) return;
					loadError = null;
					lastScan = scan;
					lastLibraries = libRes.libraries || [];
					renderFolders(lastLibraries);
					applyState();
				}).catch((e) => {
					if (!alive() || gen !== refreshGen) return;
					loadError = e.message || t('audiocheck', 'Request failed.');
					renderFolders(lastLibraries);
					applyState();
				});
			}

			function onScanClick() {
				triggerScanFlow(handlers.scanButtons, refresh, alive).catch((e) => {
					AudioCheckMessaging.toast(e.message, 'error');
				});
			}

			if (window.AudioCheckPageChrome) {
				AudioCheckPageChrome.setActions(makeAddButton('ac-btn--primary ac-library-header__add', t('audiocheck', 'Add a folder')));
			}

			summaryEl = C.el('p', {
				className: 'ac-library-bar__status ac-library-bar__status--muted',
				attrs: { role: 'status', 'aria-live': 'polite' },
				text: t('audiocheck', 'Loading…'),
			});
			scanBtn = C.el('button', {
				type: 'button',
				className: 'ac-btn ac-library-bar__scan',
				text: t('audiocheck', 'Scan now'),
				onClick: onScanClick,
			});

			addStatusEl = C.el('p', {
				className: 'ac-library-add__status',
				attrs: { role: 'status', 'aria-live': 'polite', hidden: true },
			});
			cronCallout = C.el('p', {
				className: 'ac-callout ac-callout--info',
				attrs: { role: 'status', hidden: true },
				text: t('audiocheck', 'This server uses AJAX background jobs instead of system cron. Scans continue while you use AudioCheck; for faster indexing, ask an administrator to enable system cron in Nextcloud settings.'),
			});
			listHost = C.el('div', { className: 'ac-library-folders' });
			quickLinks = C.el('div', {
				className: 'ac-library-links',
				attrs: { role: 'group', 'aria-label': t('audiocheck', 'Open your collection'), hidden: true },
			});
			quickLinks.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn ac-btn--primary',
				text: t('audiocheck', 'Open Music'),
				onClick: () => AudioCheckRouter.navigate('music', {}, true),
			}));
			quickLinks.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Audiobooks'),
				onClick: () => AudioCheckRouter.navigate('audiobooks', {}, true),
			}));
			quickLinks.appendChild(C.el('button', {
				type: 'button',
				className: 'ac-btn',
				text: t('audiocheck', 'Open Browse'),
				onClick: () => AudioCheckRouter.navigate('browse', {}, true),
			}));

			const statusBar = C.el('div', { className: 'ac-library-bar' });
			statusBar.appendChild(summaryEl);

			const folderBody = C.el('div', { className: 'ac-library-folders-body' });
			folderBody.appendChild(statusBar);
			folderBody.appendChild(addStatusEl);
			folderBody.appendChild(cronCallout);
			folderBody.appendChild(listHost);
			folderBody.appendChild(quickLinks);

			foldersCard = C.sectionCard(
				t('audiocheck', 'Your folders'),
				null,
				folderBody,
				scanBtn,
				'ac-library-folders-heading',
			);
			foldersCard.classList.add('ac-library-folders-section');
			body.appendChild(foldersCard);

			const howBody = C.el('div', { className: 'ac-library-how' });
			const steps = C.el('ol', { className: 'ac-steps ac-library-steps' });
			[
				t('audiocheck', 'Add music folder or Add audiobook folder — pick the matching folder in Files.'),
				t('audiocheck', 'Scanning starts automatically. Use Scan now if you add files later.'),
				t('audiocheck', 'Open Music or Audiobooks — listen to albums, playlists, and chapters.'),
			].forEach((text) => steps.appendChild(C.el('li', { text })));
			howBody.appendChild(steps);
			howBody.appendChild(C.el('p', {
				className: 'ac-field__hint ac-library-layout-hint',
				attrs: { role: 'note' },
				text: t('audiocheck', 'Tip: Author / Book / chapter folders work best. Nested scanning stays on by default.'),
			}));
			body.appendChild(C.collapsibleSectionCard(
				t('audiocheck', 'How it works'),
				t('audiocheck', 'Add folders, scan, then open Music or Audiobooks.'),
				howBody,
				'ac-library-how-heading',
			));

			body.appendChild(C.collapsibleSectionCard(
				t('audiocheck', 'Supported formats'),
				t('audiocheck', 'Common audio types that play in most browsers.'),
				C.el('p', {
					className: 'ac-field__hint',
					text: t('audiocheck', 'Usually plays in the browser: MP3, M4A, M4B, AAC, OGG, Opus, WAV. FLAC, WMA, and AIFF may need another app or browser.'),
				}),
				'ac-library-formats-heading',
			));

			frag.appendChild(body);
			refresh();
			return frag;
		},
	});
})();
