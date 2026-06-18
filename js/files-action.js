(function () {
	'use strict';
	if (!window.OCA) window.OCA = {};
	OCA.AudioCheck = OCA.AudioCheck || {};

	const AUDIO_MIMES = [
		'audio/mpeg',
		'audio/mp4',
		'audio/x-m4a',
		'audio/m4a',
		'audio/m4b',
		'audio/x-m4b',
		'audio/flac',
		'audio/ogg',
		'audio/vorbis',
		'audio/opus',
		'audio/wav',
		'audio/x-wav',
		'audio/aac',
		'audio/aiff',
		'audio/x-aiff',
		'audio/webm',
	];

	const AUDIO_CONTAINER_EXTENSIONS = ['mp4', 'm4a', 'm4b'];

	function isAudioContainerFilename(filename) {
		const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
		return AUDIO_CONTAINER_EXTENSIONS.includes(ext);
	}

	function openInAudioCheck(query) {
		window.location = OC.generateUrl('/apps/audiocheck/') + '?' + query;
	}

	document.addEventListener('DOMContentLoaded', () => {
		if (!OCA.Files || !OCA.Files.fileActions) return;

		AUDIO_MIMES.forEach((mime) => {
			OCA.Files.fileActions.registerAction({
				name: 'playInAudioCheck',
				displayName: t('audiocheck', 'Play in AudioCheck'),
				mime,
				permissions: OC.PERMISSION_READ,
				order: -50,
				icon: function () { return OC.imagePath('audiocheck', 'app.svg'); },
				actionHandler: (filename, context) => {
					const fileId = context.$file.attr('data-id');
					if (fileId) openInAudioCheck('fileId=' + encodeURIComponent(fileId));
				},
			});
		});

		OCA.Files.fileActions.registerAction({
			name: 'playInAudioCheckMp4',
			displayName: t('audiocheck', 'Play in AudioCheck'),
			mime: 'video/mp4',
			permissions: OC.PERMISSION_READ,
			order: -50,
			icon: function () { return OC.imagePath('audiocheck', 'app.svg'); },
			enabled: (filename) => isAudioContainerFilename(filename),
			actionHandler: (filename, context) => {
				if (!isAudioContainerFilename(filename)) {
					return;
				}
				const fileId = context.$file.attr('data-id');
				if (fileId) openInAudioCheck('fileId=' + encodeURIComponent(fileId));
			},
		});

		OCA.Files.fileActions.registerAction({
			name: 'playFolderInAudioCheck',
			displayName: t('audiocheck', 'Play folder as album'),
			mime: 'httpd/unix-directory',
			permissions: OC.PERMISSION_READ,
			order: -49,
			icon: function () { return OC.imagePath('audiocheck', 'app.svg'); },
			actionHandler: (filename, context) => {
				const folderId = context.$file.attr('data-id');
				if (folderId) openInAudioCheck('folderId=' + encodeURIComponent(folderId));
			},
		});
	});
})();
