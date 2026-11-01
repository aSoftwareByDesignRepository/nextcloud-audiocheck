<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Per-playlist order preference:
 *  - ac_playlists.ui_sort — remembers which order the user chose for this
 *    playlist ('manual', 'name', 'name_desc', 'track', 'track_desc'). A manual
 *    drag-reorder resets it to 'manual'.
 */
class Version1009Date20261031130000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_playlists') && !$schema->getTable('ac_playlists')->hasColumn('ui_sort')) {
			$schema->getTable('ac_playlists')->addColumn('ui_sort', Types::STRING, [
				'length' => 16,
				'notnull' => true,
				'default' => 'manual',
			]);
		}

		return $schema;
	}
}
