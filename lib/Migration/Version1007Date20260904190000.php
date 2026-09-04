<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Shared (multi-node) rate-limit hits for cover / expensive endpoints.
 */
class Version1007Date20260904190000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('ac_rate_limits')) {
			$t = $schema->createTable('ac_rate_limits');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('bucket', Types::STRING, ['length' => 64, 'notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['length' => 64, 'notnull' => true, 'default' => '']);
			$t->addColumn('hit_at', Types::INTEGER, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['bucket', 'user_id', 'hit_at'], 'ac_rl_buc_usr_at_idx');
			$t->addIndex(['hit_at'], 'ac_rl_hit_at_idx');
		}

		return $schema;
	}
}
