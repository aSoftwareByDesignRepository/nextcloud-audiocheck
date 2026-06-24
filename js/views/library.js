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

	function scanStatusKey(status) {
		if (status === 'running') return t('audiocheck', 'Running');
		if (status === 'queued') return t('audiocheck', 'Queued');
		if (status === 'idle') return t('audiocheck', 'Idle');
		if (status === 'failed' || status === 'error') return t('audiocheck', 'Failed');
		return status || t('audiocheck', 'Unknown');
	}

	function scanBadgeClass(status) {
		if (status === 'running' || status === 'queued') return 'ac-badge ac-badge--active';
		if (status === 'idle') return 'ac-badge ac-badge--ok';
		if (status === 'failed' || status === 'error') return 'ac-badge ac-badge--warn';
		return 'ac-badge';
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
			let text = t('audiocheck', 'Scan failed. Press Scan now to try again.');
			if (scan.lastError) {
				text += ' ' + t('audiocheck', 'Last error: {error}', { error: scan.lastError });
			}
			return { text, tone: 'warn' };
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

	/**
	 * One-decision-at-a-time content-type chooser shown after a folder is picked.
	 * Large, labelled radio cards keep the choice obvious and keyboard-friendly.
	 * @returns {Promise<string|null>} chosen kind, or null if cancelled
	 */
	function pickContentKindModal() {
		return new Promise((resolve) => {
			let selected = 'auto';
			const groupName = 'ac-content-kind-' + Math.random().toString(36).slice(2);
			const group = C.el('div', {
				className: 'ac-choice-group',
				attrs: { role: 'radiogroup', 'aria-label': t('audiocheck', 'Content type') },
			});
			CONTENT_KINDS.forEach((kind) => {
				const mod = libraryCardModifier(kind);
				const isDefault = kind === selected;
				const option = C.el('label', { className: 'ac-choice ac-choice--' + mod });
				const input = C.el('input', {
					type: 'radio',
					className: 'ac-choice__input',
					attrs: { name: groupName, value: kind, checked: isDefault ? true : undefined, autofocus: isDefault ? true : undefined },
				});
				input.addEventListener('change', () => { if (input.checked) selected = kind; });
				option.appendChild(input);
				const iconKind = mod === 'auto' ? 'folder' : mod;
				option.appendChild(C.kindIcon(iconKind, 'ac-choice__icon'));
				const textWrap = C.el('span', { className: 'ac-choice__body' });
				const titleRow = C.el('span', { className: 'ac-choice__title-row' });
				titleRow.appendChild(C.el('span', { className: 'ac-choice__title', text: contentKindLabel(kind) }));
				if (kind === 'auto') {
					titleRow.appendChild(C.el('span', {
						className: 'ac-badge ac-badge--ok ac-choice__badge',
						text: t('audiocheck', 'Recommended'),
					}));
				}
				textWrap.appendChild(titleRow);
				textWrap.appendChild(C.el('span', { className: 'ac-choice__desc', text: contentKindHint(kind) }));
				option.appendChild(textWrap);
				group.appendChild(option);
			});
			const intro = C.el('p', {
				className: 'ac-field__hint ac-content-kind-picker__intro',
				text: t('audiocheck', 'Tell AudioCheck what lives in this folder. You can change this later.'),
			});
			C.openModal({
				title: t('audiocheck', 'What is in this folder?'),
				primaryLabel: t('audiocheck', 'Add folder'),
				dialogClass: 'ac-modal__dialog--narrow',
				render() {
					return C.el('div', { className: 'ac-content-kind-picker' }, [intro, group]);
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
			return resolveContentKind(presetKind).then((contentKind) => {
				if (alive && !alive()) return null;
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
			let loading = true;
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

			function makeAddButton(extraClass) {
				const btn = C.el('button', {
					type: 'button',
					className: 'ac-btn ac-btn--primary js-ac-add-folder' + (extraClass ? ' ' + extraClass : ''),
					onClick: () => runAddFolder(handlers),
				});
				if (window.AudioCheckIcons && AudioCheckIcons.createSvg) {
					btn.appendChild(AudioCheckIcons.createSvg('add'));
				}
				btn.appendChild(document.createTextNode(t('audiocheck', 'Add a folder')));
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
					// First scan (folders but nothing indexed) is the key action → primary.
					scanBtn.classList.toggle('ac-btn--primary', !blocked && tracks === 0);
					scanBtn.textContent = scanning ? t('audiocheck', 'Scanning…') : t('audiocheck', 'Scan now');
				}
			}

			function applyState() {
				if (!alive()) return;
				loading = false;
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

				const cardBody = C.el('div', { className: 'ac-library-card__row' });

				const identity = C.el('div', { className: 'ac-library-card__identity' });
				identity.appendChild(C.kindIcon(kindMod, 'ac-library-card__icon'));
				const titles = C.el('div', { className: 'ac-library-card__titles' });
				const titleRow = C.el('div', { className: 'ac-library-card__title-row' });
				titleRow.appendChild(C.el('h3', {
					className: 'ac-library-card__name',
					text: folderDisplayName(lib.folderPath),
				}));
				titleRow.appendChild(C.el('span', {
					className: 'ac-library-card__kind ' + contentKindBadgeClass(lib.contentKind),
					text: contentKindLabel(lib.contentKind),
				}));
				titles.appendChild(titleRow);
				titles.appendChild(C.el('p', {
					className: 'ac-library-card__path',
					text: pathLabel,
				}));
				identity.appendChild(titles);
				const head = C.el('div', { className: 'ac-library-card__head' });
				head.appendChild(identity);

				const stats = C.el('dl', { className: 'ac-library-card__stats' });
				const item = C.el('div', {
					className: 'ac-library-card__stat' + (trackCount > 0 ? ' ac-library-card__stat--ok' : ' ac-library-card__stat--empty'),
				});
				item.appendChild(C.el('dt', { className: 'ac-library-card__stat-label', text: t('audiocheck', 'Tracks') }));
				item.appendChild(C.el('dd', {
					className: 'ac-library-card__stat-value',
					text: trackCount > 0 ? String(trackCount) : t('audiocheck', 'No tracks yet'),
				}));
				stats.appendChild(item);
				head.appendChild(stats);
				cardBody.appendChild(head);

				const actions = C.el('div', {
					className: 'ac-library-card__actions',
					attrs: { role: 'group', 'aria-label': t('audiocheck', 'Folder settings for {folder}', { folder: pathLabel }) },
				});

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
					text: t('audiocheck', 'Subfolders'),
				}));
				const scopeSelect = C.el('select', {
					id: scopeSelectId,
					className: 'ac-input ac-library-card__select',
					attrs: { 'aria-label': t('audiocheck', 'Subfolders for {folder}', { folder: pathLabel }) },
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
				cardBody.appendChild(actions);
				row.appendChild(cardBody);

				if (!lib.enabled) {
					row.appendChild(C.el('p', {
						className: 'ac-library-card__message ac-library-card__warn',
						attrs: { role: 'alert' },
						text: t('audiocheck', 'This folder is unavailable. Remove it or restore access in Files.'),
					}));
				} else if (trackCount === 0 && !isScanning(lastScan)) {
					row.appendChild(C.el('p', {
						className: 'ac-library-card__message ac-library-card__hint',
						attrs: { role: 'status' },
						text: t('audiocheck', 'Press Scan now if audio does not appear after a moment.'),
					}));
				}

				return row;
			}

			function renderEmptyFolders() {
				const empty = C.emptyState(
					t('audiocheck', 'No folders yet'),
					t('audiocheck', 'Add a folder from your Files. AudioCheck will scan it for music and audiobooks.'),
					{
						variant: 'section',
						icon: 'folder',
						ctaLabel: t('audiocheck', 'Add a folder'),
						onCta: () => runAddFolder(handlers),
					},
				);
				const cta = empty.querySelector('.ac-btn');
				if (cta) cta.classList.add('js-ac-add-folder');
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
				if (list.length > 1) {
					listHost.appendChild(C.el('p', {
						className: 'ac-field__hint ac-library-overlap-hint',
						attrs: { role: 'note' },
						text: t('audiocheck', 'Tip: use separate roots for music and audiobooks. Avoid nested folders that overlap (for example /Music and /Music/Albums).'),
					}));
				}
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
					loading = false;
					renderFolders(lastLibraries);
					applyState();
				});
			}

			function onScanClick() {
				triggerScanFlow(handlers.scanButtons, refresh, alive).catch((e) => {
					AudioCheckMessaging.toast(e.message, 'error');
				});
			}

			// —— Header action: add folder ——
			if (window.AudioCheckPageChrome) {
				AudioCheckPageChrome.setActions(makeAddButton('ac-library-header__add'));
			}

			// —— Card: Your folders (status bar + scan + list + links) ——
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
			const statusBar = C.el('div', { className: 'ac-library-bar' });
			statusBar.appendChild(summaryEl);

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

			// —— Help: how it works + supported formats ——
			const steps = C.el('ol', { className: 'ac-steps ac-library-steps' });
			[
				t('audiocheck', 'Add music folder or Add audiobook folder — pick the matching folder in Files.'),
				t('audiocheck', 'Scan now — AudioCheck indexes audio inside your folders.'),
				t('audiocheck', 'Open Music or Audiobooks — listen to albums, playlists, and chapters.'),
			].forEach((text) => steps.appendChild(C.el('li', { text })));
			body.appendChild(C.collapsibleSectionCard(
				t('audiocheck', 'How it works'),
				t('audiocheck', 'Add folders, scan, then open Music or Audiobooks.'),
				steps,
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
