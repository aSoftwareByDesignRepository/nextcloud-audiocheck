(function () {
	'use strict';

	const CANCEL_RE = /FilePicker:\s*No nodes selected/i;
	const INTRO_SKIP_KEY = 'audiocheck_skip_folder_intro';
	const PICKER_MIME_FILTER = ['*', 'httpd/unix-directory'];

	function isPickerCancelled(reason) {
		if (!reason) return false;
		if (typeof reason === 'string') return CANCEL_RE.test(reason);
		return CANCEL_RE.test(reason.message || '');
	}

	function isDirectoryInfo(info) {
		if (!info) return false;
		if (typeof info.isDirectory === 'function' && info.isDirectory()) return true;
		if (info.type === 'directory') return true;
		const mime = String(info.mimetype || info.mime || '').toLowerCase();
		return mime === 'httpd/unix-directory';
	}

	function fileIdFromInfo(info) {
		if (!info) return null;
		const raw = info.id ?? info.fileid ?? info.fileId;
		const id = parseInt(String(raw ?? ''), 10);
		return Number.isFinite(id) && id > 0 ? id : null;
	}

	function currentUserId() {
		try {
			if (window.OC && typeof OC.getCurrentUser === 'function') {
				const user = OC.getCurrentUser();
				if (user && user.uid) return String(user.uid);
			}
		} catch (_) { /* ignore */ }
		return '';
	}

	function normalizePickerPath(rawPath) {
		let path = String(rawPath || '').trim();
		if (!path) return '';
		try {
			if (/^https?:\/\//i.test(path)) {
				path = new URL(path, window.location.origin).pathname;
			}
		} catch (_) { /* keep path */ }

		const uid = currentUserId();
		if (uid) {
			const prefixes = [
				'/remote.php/dav/files/' + uid,
				'/' + uid + '/files',
			];
			prefixes.forEach((prefix) => {
				if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
					path = path.slice(prefix.length);
				}
			});
		}

		path = path.replace(/^\/+/, '').replace(/\/+$/, '');
		return path ? '/' + path : '/';
	}

	function lastPickerPath() {
		try {
			return normalizePickerPath(sessionStorage.getItem('NC.FilePicker.LastPath') || '');
		} catch (_) {
			return '';
		}
	}

	function pathCandidates(rawPath) {
		const out = [];
		const add = (p) => {
			const s = normalizePickerPath(p);
			if (!s || s === '/' || out.includes(s)) return;
			out.push(s);
		};
		let path = normalizePickerPath(rawPath);
		if (!path || path === '/') path = lastPickerPath();
		if (path && path !== '/') {
			add(path);
		}
		const bare = String(rawPath || '').trim().replace(/^\/+/, '');
		if (bare) add('/' + bare);
		return out;
	}

	function getFileInfoAsync(path) {
		return new Promise((resolve, reject) => {
			if (!window.OC || !OC.Files || !OC.Files.getClient) {
				reject(new Error('files_client_unavailable'));
				return;
			}
			const clientPath = path.startsWith('/') ? path : '/' + path;
			OC.Files.getClient().getFileInfo(clientPath).then((_status, info) => {
				resolve(info);
			}).fail(() => {
				reject(new Error('get_file_info_failed'));
			});
		});
	}

	/**
	 * @param {string} [rawPath]
	 * @returns {Promise<number|null>}
	 */
	function resolveFolderFileId(rawPath) {
		const candidates = pathCandidates(rawPath);
		let chain = Promise.resolve(null);
		candidates.forEach((candidate) => {
			chain = chain.then((found) => {
				if (found) return found;
				const rel = candidate.replace(/^\/+/, '');
				const tries = [candidate, '/' + rel, rel];
				let inner = Promise.resolve(null);
				tries.forEach((tryPath) => {
					inner = inner.then((id) => {
						if (id) return id;
						return getFileInfoAsync(tryPath).then((info) => {
							if (!isDirectoryInfo(info)) return null;
							return fileIdFromInfo(info);
						}).catch(() => null);
					});
				});
				return inner;
			});
		});
		return chain;
	}

	function shouldShowIntro() {
		try {
			return localStorage.getItem(INTRO_SKIP_KEY) !== '1';
		} catch (_) {
			return true;
		}
	}

	function showFolderPickerIntro() {
		return new Promise((resolve) => {
			if (!window.AudioCheckComponents || typeof AudioCheckComponents.openModal !== 'function') {
				resolve(true);
				return;
			}
			const C = AudioCheckComponents;
			let skipNext = false;
			C.openModal({
				title: t('audiocheck', 'Add a library folder'),
				primaryLabel: t('audiocheck', 'Open folder picker'),
				cancelLabel: t('audiocheck', 'Cancel'),
				onCancel: () => resolve(false),
				render() {
					const callout = C.createElement('p', {
						className: 'ac-callout ac-folder-picker-help__callout',
						attrs: { role: 'note' },
						text: t('audiocheck', 'You are adding a folder to scan — not picking a single song. Use the “Choose …” button at the bottom of the dialog to confirm the folder.'),
					});
					const steps = C.createElement('ol', { className: 'ac-steps' }, [
						C.createElement('li', { text: t('audiocheck', 'Browse to the folder with your audio (double-click folder rows to open them).') }),
						C.createElement('li', { text: t('audiocheck', 'Songs in the list only confirm you are in the right place — do not click them.') }),
						C.createElement('li', { text: t('audiocheck', 'Click the “Choose …” button at the bottom (for example “Choose Music”). That selects the whole folder you are viewing.') }),
						C.createElement('li', { text: t('audiocheck', 'Shortcut: from the parent folder, single-click the folder you want, then click “Choose …”.') }),
					]);
					const note = C.createElement('p', {
						className: 'ac-field__hint ac-folder-picker-help__note',
						text: t('audiocheck', 'AudioCheck indexes audio inside the folder. Subfolders are included when enabled in Settings.'),
					});
					const skipRow = C.createElement('div', { className: 'ac-form-row ac-form-row--checkbox' });
					const skipInput = C.createElement('input', {
						type: 'checkbox',
						id: 'ac-skip-folder-intro',
						on: {
							change: () => { skipNext = !!skipInput.checked; },
						},
					});
					skipRow.appendChild(skipInput);
					skipRow.appendChild(C.createElement('label', {
						attrs: { for: 'ac-skip-folder-intro' },
						text: t('audiocheck', 'Do not show this again'),
					}));
					return C.createElement('div', { className: 'ac-folder-picker-help' }, [callout, steps, note, skipRow]);
				},
				onSubmit: () => {
					if (skipNext) {
						try { localStorage.setItem(INTRO_SKIP_KEY, '1'); } catch (_) { /* ignore */ }
					}
					resolve(true);
					return true;
				},
			});
		});
	}

	/**
	 * @param {string} pickedPath
	 * @returns {Promise<{ fileId: number|null, pickedPath: string }>}
	 */
	function resolvePickerSelection(pickedPath) {
		const normalized = normalizePickerPath(pickedPath);
		if (!normalized || normalized === '/') {
			return Promise.resolve({ fileId: null, pickedPath: '' });
		}
		const rel = normalized.replace(/^\/+/, '');
		const tryPaths = [normalized, '/' + rel, rel];
		let infoChain = Promise.resolve(null);
		tryPaths.forEach((tryPath) => {
			infoChain = infoChain.then((found) => {
				if (found) return found;
				return getFileInfoAsync(tryPath).catch(() => null);
			});
		});
		return infoChain.then((info) => {
			if (info && !isDirectoryInfo(info)) {
				AudioCheckMessaging.toast(
					t('audiocheck', 'That is a file, not a folder. Open the folder that contains it, then click the Choose … button at the bottom.'),
					'error',
				);
				return { fileId: null, pickedPath: '' };
			}
			return resolveFolderFileId(normalized).then((fileId) => ({
				fileId,
				pickedPath: normalized,
			}));
		});
	}

	function openModernFolderPicker() {
		return import('@nextcloud/dialogs').then((dialogs) => {
			if (!dialogs || typeof dialogs.getFilePickerBuilder !== 'function') {
				return undefined;
			}
			const typeChoose = (dialogs.FilePickerType && dialogs.FilePickerType.Choose) || 1;
			const picker = dialogs.getFilePickerBuilder(t('audiocheck', 'Select audio folder'))
				.setMultiSelect(false)
				.setMimeTypeFilter(PICKER_MIME_FILTER)
				.allowDirectories(true)
				.setType(typeChoose)
				.build();
			return picker.pick().then((pickedPath) => {
				if (!pickedPath) return null;
				return resolvePickerSelection(pickedPath);
			});
		}).catch(() => undefined);
	}

	function openLegacyFolderPicker() {
		return new Promise((resolve) => {
			if (!window.OC || !OC.dialogs || typeof OC.dialogs.filepicker !== 'function') {
				AudioCheckMessaging.toast(t('audiocheck', 'Open the Files app to pick a folder.'), 'warning');
				resolve(null);
				return;
			}

			let settled = false;
			const finish = (selection) => {
				if (settled) return;
				settled = true;
				window.removeEventListener('unhandledrejection', onPickerDismiss);
				clearTimeout(safetyTimer);
				resolve(selection);
			};

			const onPickerDismiss = (event) => {
				if (!isPickerCancelled(event.reason)) return;
				event.preventDefault();
				finish(null);
			};
			window.addEventListener('unhandledrejection', onPickerDismiss);
			const safetyTimer = window.setTimeout(() => finish(null), 10 * 60 * 1000);

			const typeChoose = OC.dialogs.FILEPICKER_TYPE_CHOOSE || 1;
			try {
				OC.dialogs.filepicker(
					t('audiocheck', 'Select audio folder'),
					(path) => {
						resolvePickerSelection(path).then((selection) => {
							if (!selection.fileId && !selection.pickedPath) {
								AudioCheckMessaging.toast(
									t('audiocheck', 'Could not resolve folder. Open the folder in the picker, then use the Choose … button at the bottom.'),
									'error',
								);
							}
							finish(selection);
						});
					},
					false,
					PICKER_MIME_FILTER,
					true,
					typeChoose,
					'',
					{ allowDirectoryChooser: true },
				);
			} catch (err) {
				if (!isPickerCancelled(err)) {
					AudioCheckMessaging.toast(t('audiocheck', 'Could not open folder picker.'), 'error');
				}
				finish(null);
			}
		});
	}

	function openNativeFolderPicker() {
		return openModernFolderPicker().then((modernResult) => {
			if (modernResult !== undefined) return modernResult;
			return openLegacyFolderPicker();
		});
	}

	/**
	 * @param {{ skipIntro?: boolean }} [options]
	 * @returns {Promise<{ fileId: number|null, pickedPath: string }|null>}
	 */
	function pickFolder(options) {
		const opts = options || {};
		const runIntro = !opts.skipIntro && shouldShowIntro();
		return (runIntro ? showFolderPickerIntro() : Promise.resolve(true))
			.then((proceed) => (proceed ? openNativeFolderPicker() : null));
	}

	window.AudioCheckFolderPicker = {
		pickFolder,
		openNativeFolderPicker,
		resolveFolderFileId,
		normalizePickerPath,
		isPickerCancelled,
		resetIntroPreference() {
			try { localStorage.removeItem(INTRO_SKIP_KEY); } catch (_) { /* ignore */ }
		},
	};
})();
