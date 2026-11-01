<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Natural ordering + folder-assisted collection grouping:
 *  - ac_tracks.collection_folder — scan-derived "book folder" (disc folders
 *    collapse to their parent); feeds effectiveAlbumSql when a library opts in.
 *  - ac_libraries.group_by_folder — per-library opt-in flag.
 */
class Version1008Date20261031120000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_tracks') && !$schema->getTable('ac_tracks')->hasColumn('collection_folder')) {
			$schema->getTable('ac_tracks')->addColumn('collection_folder', Types::STRING, [
				'length' => 4000,
				'notnull' => false,
				'default' => null,
			]);
		}
		if ($schema->hasTable('ac_libraries') && !$schema->getTable('ac_libraries')->hasColumn('group_by_folder')) {
			$schema->getTable('ac_libraries')->addColumn('group_by_folder', Types::INTEGER, [
				'notnull' => true,
				'default' => 0,
			]);
		}

		return $schema;
	}
}
