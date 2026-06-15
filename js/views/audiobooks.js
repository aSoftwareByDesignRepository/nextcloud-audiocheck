(function () {
	'use strict';

	AudioCheckMediaLibraryPage.register({
		viewId: 'audiobooks',
		kind: 'audiobook',
		title: t('audiocheck', 'Audiobooks'),
		help: t('audiocheck', 'Browse audiobook titles, folders, and books.'),
		viewsAriaLabel: t('audiocheck', 'Audiobook views'),
		playAllKindLabel: t('audiocheck', 'Audiobooks'),
		emptyIcon: 'audiobook',
		sortArtistLabel: t('audiocheck', 'Author'),
		tabs: [
			{ id: 'tracks', label: t('audiocheck', 'Titles') },
			{ id: 'albums', label: t('audiocheck', 'By book') },
			{ id: 'folders', label: t('audiocheck', 'By folder') },
		],
		tabLeads: {
			tracks: t('audiocheck', 'Every audiobook in your library. Press Play on a row to listen.'),
			albums: t('audiocheck', 'Grouped by book title when your files include album tags. No tags? Use Titles instead.'),
			folders: t('audiocheck', 'Audiobooks grouped by the folders you added in Library. Open a folder to see its titles.'),
		},
		emptyTracks: t('audiocheck', 'Add an audiobook folder in Library (set content type to Audiobooks or Auto-detect) and scan.'),
		emptyAlbums: t('audiocheck', 'Books appear when your files include book or album metadata, or switch to Titles for every file.'),
		emptyFolders: t('audiocheck', 'Folder groups appear after you add library folders and scan.'),
	});
})();
