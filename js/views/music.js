(function () {
	'use strict';

	AudioCheckMediaLibraryPage.register({
		viewId: 'music',
		kind: 'music',
		title: t('audiocheck', 'Music'),
		help: t('audiocheck', 'Browse tracks, folders, and albums.'),
		viewsAriaLabel: t('audiocheck', 'Music views'),
		playAllKindLabel: t('audiocheck', 'Music'),
		emptyIcon: 'music',
		sortArtistLabel: t('audiocheck', 'Artist'),
		tabs: [
			{ id: 'tracks', label: t('audiocheck', 'Tracks') },
			{ id: 'albums', label: t('audiocheck', 'Albums') },
			{ id: 'folders', label: t('audiocheck', 'By folder') },
		],
		tabLeads: {
			tracks: t('audiocheck', 'Every song in your library. Press Play on a row to listen.'),
			albums: t('audiocheck', 'Grouped by album when your files include album tags. No tags? Use Tracks instead.'),
			folders: t('audiocheck', 'Music grouped by the folders you added in Library. Open a folder to see its tracks.'),
		},
		emptyTracks: t('audiocheck', 'Add a music folder in Library (set content type to Music) and scan.'),
		emptyAlbums: t('audiocheck', 'Albums appear when your files include album metadata, or switch to Tracks for every title.'),
		emptyFolders: t('audiocheck', 'Folder groups appear after you add library folders and scan.'),
	});
})();
