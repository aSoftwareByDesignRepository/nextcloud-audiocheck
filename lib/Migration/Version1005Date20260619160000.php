<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Per-user listened flag independent of raw playback position (plan §3.5).
 */
class Version1005Date20260619160000 extends SimpleMigrationStep
{
	public function __construct(
		private IDBConnection $db,
	) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('ac_play_state')) {
			$t = $schema->getTable('ac_play_state');
			if (!$t->hasColumn('listened')) {
				$t->addColumn('listened', 'integer', ['notnull' => true, 'default' => 0]);
			}
		}

		return $schema;
	}

	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_play_state')
			->set('listened', $qb->createNamedParameter(1, \PDO::PARAM_INT))
			->where($qb->expr()->eq('finished', $qb->createNamedParameter(1, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('listened', $qb->createNamedParameter(0, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}
}
