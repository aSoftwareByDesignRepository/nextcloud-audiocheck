<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Series facet column on ac_file_meta (derived from ID3/M4B tags on scan). */
class Version1002Date20260615140000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_file_meta')) {
			$t = $schema->getTable('ac_file_meta');
			if (!$t->hasColumn('series')) {
				$t->addColumn('series', 'string', ['length' => 512, 'notnull' => false]);
			}
			if (!$t->hasIndex('ac_meta_series_idx')) {
				$t->addIndex(['series'], 'ac_meta_series_idx');
			}
		}

		return $schema;
	}
}
