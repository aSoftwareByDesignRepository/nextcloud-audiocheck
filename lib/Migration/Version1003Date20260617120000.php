<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Per-library folder content classification (auto, music, audiobook).
 * Version1001Date20260616120000 was never applied (numbered below executed 1002).
 */
class Version1003Date20260617120000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_libraries')) {
			$table = $schema->getTable('ac_libraries');
			if (!$table->hasColumn('content_kind')) {
				$table->addColumn('content_kind', 'string', [
					'length' => 16,
					'notnull' => true,
					'default' => 'auto',
				]);
			}
		}

		return $schema;
	}
}
