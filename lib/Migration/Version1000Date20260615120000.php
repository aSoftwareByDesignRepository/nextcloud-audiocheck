<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Initial AudioCheck schema — seven tables, guarded, Oracle-safe identifiers.
 */
class Version1000Date20260615120000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('ac_libraries')) {
			$t = $schema->createTable('ac_libraries');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('folder_path', 'string', ['length' => 4000, 'notnull' => true]);
			$t->addColumn('root_file_id', 'bigint', ['notnull' => false]);
			$t->addColumn('include_subfolders', 'integer', ['notnull' => true, 'default' => 1]);
			$t->addColumn('content_kind', 'string', ['length' => 16, 'notnull' => true, 'default' => 'auto']);
			$t->addColumn('enabled', 'integer', ['notnull' => true, 'default' => 1]);
			$t->addColumn('created_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_lib_pk');
			$t->addUniqueIndex(['user_id', 'root_file_id'], 'ac_lib_user_root_uq');
			$t->addIndex(['user_id'], 'ac_lib_user_idx');
		}

		if (!$schema->hasTable('ac_file_meta')) {
			$t = $schema->createTable('ac_file_meta');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('file_id', 'bigint', ['notnull' => true]);
			$t->addColumn('etag', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('mimetype', 'string', ['length' => 128, 'notnull' => true]);
			$t->addColumn('kind', 'string', ['length' => 16, 'notnull' => true, 'default' => 'music']);
			$t->addColumn('duration_ms', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('bitrate', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('title', 'string', ['length' => 512, 'notnull' => false]);
			$t->addColumn('artist', 'string', ['length' => 512, 'notnull' => false]);
			$t->addColumn('album', 'string', ['length' => 512, 'notnull' => false]);
			$t->addColumn('album_artist', 'string', ['length' => 512, 'notnull' => false]);
			$t->addColumn('genre', 'string', ['length' => 255, 'notnull' => false]);
			$t->addColumn('track_no', 'integer', ['notnull' => false]);
			$t->addColumn('disc_no', 'integer', ['notnull' => false]);
			$t->addColumn('release_year', 'integer', ['notnull' => false]);
			$t->addColumn('has_chapters', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('chapters_json', 'text', ['notnull' => false]);
			$t->addColumn('cover_state', 'string', ['length' => 16, 'notnull' => true, 'default' => 'none']);
			$t->addColumn('analyzed_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_meta_pk');
			$t->addUniqueIndex(['file_id'], 'ac_meta_file_uq');
			$t->addIndex(['artist'], 'ac_meta_artist_idx');
			$t->addIndex(['album'], 'ac_meta_album_idx');
		}

		if (!$schema->hasTable('ac_tracks')) {
			$t = $schema->createTable('ac_tracks');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('file_id', 'bigint', ['notnull' => true]);
			$t->addColumn('meta_id', 'bigint', ['notnull' => false]);
			$t->addColumn('rel_path', 'string', ['length' => 4000, 'notnull' => true]);
			$t->addColumn('file_name', 'string', ['length' => 512, 'notnull' => true]);
			$t->addColumn('mtime', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('size', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('etag', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('library_id', 'bigint', ['notnull' => false]);
			$t->addColumn('added_at', 'bigint', ['notnull' => true]);
			$t->addColumn('last_seen_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_trk_pk');
			$t->addUniqueIndex(['user_id', 'file_id'], 'ac_trk_user_file_uq');
			$t->addIndex(['user_id'], 'ac_trk_user_idx');
			$t->addIndex(['meta_id'], 'ac_trk_meta_idx');
		}

		if (!$schema->hasTable('ac_playlists')) {
			$t = $schema->createTable('ac_playlists');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('name', 'string', ['length' => 255, 'notnull' => true]);
			$t->addColumn('kind', 'string', ['length' => 16, 'notnull' => true, 'default' => 'manual']);
			$t->addColumn('is_pinned', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('default_speed', 'integer', ['notnull' => true, 'default' => 100]);
			$t->addColumn('cover_file_id', 'bigint', ['notnull' => false]);
			$t->addColumn('created_at', 'bigint', ['notnull' => true]);
			$t->addColumn('updated_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_pl_pk');
			$t->addUniqueIndex(['user_id', 'name'], 'ac_pl_user_name_uq');
			$t->addIndex(['user_id'], 'ac_pl_user_idx');
		}

		if (!$schema->hasTable('ac_playlist_items')) {
			$t = $schema->createTable('ac_playlist_items');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('playlist_id', 'bigint', ['notnull' => true]);
			$t->addColumn('file_id', 'bigint', ['notnull' => true]);
			$t->addColumn('sort_order', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('added_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_pli_pk');
			$t->addUniqueIndex(['playlist_id', 'file_id'], 'ac_pli_pl_file_uq');
			$t->addIndex(['playlist_id', 'sort_order'], 'ac_pli_pl_idx');
		}

		if (!$schema->hasTable('ac_play_state')) {
			$t = $schema->createTable('ac_play_state');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('file_id', 'bigint', ['notnull' => true]);
			$t->addColumn('position_ms', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('duration_ms', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('playback_speed', 'integer', ['notnull' => true, 'default' => 100]);
			$t->addColumn('finished', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('updated_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_ps_pk');
			$t->addUniqueIndex(['user_id', 'file_id'], 'ac_ps_user_file_uq');
			$t->addIndex(['user_id', 'updated_at'], 'ac_ps_user_upd_idx');
		}

		if (!$schema->hasTable('ac_scan_state')) {
			$t = $schema->createTable('ac_scan_state');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('status', 'string', ['length' => 16, 'notnull' => true, 'default' => 'idle']);
			$t->addColumn('last_full_scan_at', 'bigint', ['notnull' => true, 'default' => 0]);
			$t->addColumn('last_error', 'string', ['length' => 1024, 'notnull' => false]);
			$t->addColumn('tracks_total', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('cursor', 'string', ['length' => 4000, 'notnull' => false]);
			$t->addColumn('updated_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_scan_pk');
			$t->addUniqueIndex(['user_id'], 'ac_scan_user_uq');
		}

		return $schema;
	}
}
