<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

/**
 * Canonical list of AudioCheck database tables and app id for migrations/repair.
 */
final class AudioCheckTableCatalog
{
	public const APP_ID = 'audiocheck';

	/** @var list<string> */
	public const TABLES = [
		'ac_libraries',
		'ac_file_meta',
		'ac_tracks',
		'ac_playlists',
		'ac_playlist_items',
		'ac_play_state',
		'ac_scan_state',
	];
}
