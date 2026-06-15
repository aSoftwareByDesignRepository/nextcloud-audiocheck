(function () {
	'use strict';

	const CANCEL_RE = /FilePicker:\s*No nodes selected/i;

	function isPickerCancelled(reason) {
		if (!reason) return false;
		if (typeof reason === 'string') return CANCEL_RE.test(reason);
		return CANCEL_RE.test(reason.message || '');
	}

	/**
	 * Pick a folder and resolve to a Nextcloud file ID (never send paths to the API).
	 * Resolves null when the user cancels or nothing is selected (never rejects).
	 * @returns {Promise<number|null>}
	 */
	function pickFolder() {
		return new Promise((resolve) => {
			if (!window.OC || !OC.dialogs || typeof OC.dialogs.filepicker !== 'function') {
				AudioCheckMessaging.toast(t('audiocheck', 'Open the Files app to pick a folder.'), 'warning');
				resolve(null);
				return;
			}

			let settled = false;
			const finish = (fileId) => {
				if (settled) return;
				settled = true;
				window.removeEventListener('unhandledrejection', onPickerDismiss);
				clearTimeout(safetyTimer);
				resolve(fileId);
			};

			// NC 34+: legacy filepicker calls FilePicker.pick() without catching cancel.
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
					t('audiocheck', 'Choose a folder'),
					(path) => {
						if (!path || !OC.Files || !OC.Files.getClient) {
							finish(null);
							return;
						}
						OC.Files.getClient().getFileInfo(path).then((_status, info) => {
							const id = info && (info.id || info.fileid);
							finish(id ? parseInt(String(id), 10) : null);
						}).fail(() => {
							AudioCheckMessaging.toast(t('audiocheck', 'Could not resolve folder.'), 'error');
							finish(null);
						});
					},
					false,
					'httpd/unix-directory',
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

	window.AudioCheckFolderPicker = { pickFolder, isPickerCancelled };
})();
