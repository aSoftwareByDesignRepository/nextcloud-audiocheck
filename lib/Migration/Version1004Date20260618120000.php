<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Durable, server-side playback queue (one active queue per user) so the queue
 * and resume position survive browser restarts, new tabs, and other devices —
 * not only a same-tab reload. The exact resume position keeps living in
 * ac_play_state (per file); these tables only store the queue ordering, the
 * current pointer, and the playback settings (speed/shuffle/repeat).
 *
 * Oracle-safe identifiers: logical table names ≤ 27 chars, explicit short PK
 * and index names ≤ 30 chars, integer booleans, guarded creation.
 */
class Version1004Date20260618120000 extends SimpleMigrationStep
{
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper
	{
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('ac_queue')) {
			$t = $schema->createTable('ac_queue');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', 'string', ['length' => 64, 'notnull' => true]);
			$t->addColumn('current_index', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('playback_speed', 'integer', ['notnull' => true, 'default' => 100]);
			$t->addColumn('shuffle', 'integer', ['notnull' => true, 'default' => 0]);
			$t->addColumn('repeat_mode', 'string', ['length' => 8, 'notnull' => true, 'default' => 'off']);
			$t->addColumn('updated_at', 'bigint', ['notnull' => true]);
			$t->setPrimaryKey(['id'], 'ac_queue_pk');
			$t->addUniqueIndex(['user_id'], 'ac_queue_user_uq');
		}

		if (!$schema->hasTable('ac_queue_items')) {
			$t = $schema->createTable('ac_queue_items');
			$t->addColumn('id', 'bigint', ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('queue_id', 'bigint', ['notnull' => true]);
			$t->addColumn('file_id', 'bigint', ['notnull' => true]);
			$t->addColumn('sort_order', 'integer', ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id'], 'ac_qitems_pk');
			$t->addIndex(['queue_id', 'sort_order'], 'ac_qitems_q_idx');
		}

		return $schema;
	}
}
