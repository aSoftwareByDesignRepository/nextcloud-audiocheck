(function () {
	'use strict';

	AudioCheckFacetBrowsePage.register({
		viewId: 'browse',
		title: t('audiocheck', 'Browse'),
		help: t('audiocheck', 'Explore artists, genres, folders, and favorites.'),
		viewsAriaLabel: t('audiocheck', 'Browse categories'),
		tabs: [
			{ id: 'folders', labelKey: 'Folders' },
			{ id: 'artists', labelKey: 'Artists' },
			{ id: 'genres', labelKey: 'Genres' },
			{ id: 'favorites', labelKey: 'Favorites' },
			{ id: 'authors', labelKey: 'Authors' },
			{ id: 'series', labelKey: 'Series' },
			{ id: 'tags', labelKey: 'Tags' },
		],
		tabLeads: {
			folders: t('audiocheck', 'All audio grouped by folder. Open a group to see its tracks and press Play on a row.'),
			artists: t('audiocheck', 'Music grouped by artist tag. Open an artist to see their tracks.'),
			genres: t('audiocheck', 'Tracks grouped by genre. Open a genre to browse and play.'),
			favorites: t('audiocheck', 'Tracks you starred in Now playing or Browse. They also sync with the Files app.'),
			authors: t('audiocheck', 'Audiobooks grouped by author. Open an author to see their titles.'),
			series: t('audiocheck', 'Audiobook series from your file tags. Open a series to see its titles.'),
			tags: t('audiocheck', 'System tags from the Files app. Open a tag to see matching tracks.'),
		},
		emptyCopy: {
			artists: {
				title: 'No artist tags yet',
				message: 'Artist names appear here when your audio files include artist metadata. Try Folders or open Music to browse by album.',
				icon: 'music',
			},
			authors: {
				title: 'No audiobook authors yet',
				message: 'Audiobooks with author metadata appear here after scanning. Add .m4b files or long tracks in Library.',
				icon: 'audiobook',
			},
			series: {
				title: 'No series yet',
				message: 'Audiobook series tags appear here when your files include them.',
				icon: 'audiobook',
			},
			genres: {
				title: 'No genres yet',
				message: 'Genre tags appear here when your audio files include genre metadata.',
			},
			folders: {
				title: 'No folders yet',
				message: 'Folder groups appear after you add library folders and scan.',
				icon: 'folder',
			},
			favorites: {
				title: 'No favorite tracks yet',
				message: 'Star tracks in Now playing or Browse. Favorites also appear in the Files app.',
				icon: 'playlist',
			},
			tags: {
				title: 'No tags yet',
				message: 'System tags from the Files app appear here when assigned to your audio files.',
			},
		},
	});
})();
