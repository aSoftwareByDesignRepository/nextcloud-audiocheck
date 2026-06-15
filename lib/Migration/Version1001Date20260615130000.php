<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Track source mtime/size on ac_file_meta — Nextcloud etags may not change on in-place overwrites.
 */
class Version1001Date20260615130000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_file_meta')) {
			$t = $schema->getTable('ac_file_meta');
			if (!$t->hasColumn('source_mtime')) {
				$t->addColumn('source_mtime', 'bigint', ['notnull' => true, 'default' => 0]);
			}
			if (!$t->hasColumn('source_size')) {
				$t->addColumn('source_size', 'bigint', ['notnull' => true, 'default' => 0]);
			}
		}

		return $schema;
	}
}
