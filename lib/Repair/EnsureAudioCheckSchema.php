<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Repair;

use OC\DB\Connection;
use OC\DB\MigrationService;
use OC\DB\SchemaWrapper;
use OCA\AudioCheck\BackgroundJob\ScanSchedulerJob;
use OCA\AudioCheck\Migration\AudioCheckTableCatalog;
use OCP\BackgroundJob\IJobList;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;
use OCP\Server;

final class EnsureAudioCheckSchema implements IRepairStep
{
	public function __construct(
		private readonly IDBConnection $connection,
		private readonly IConfig $config,
		private readonly IJobList $jobList,
	) {
	}

	public function getName(): string
	{
		return 'Ensure AudioCheck database schema is complete';
	}

	public function run(IOutput $output): void
	{
		$this->config->deleteAppValue(UninstallDropTables::APP_ID, UninstallDropTables::REPAIR_PASS_KEY);
		$this->ensureBackgroundJobs($output);

		$missingBefore = $this->missingTables();
		$needsMigrate = $missingBefore !== []
			|| $this->missingLibraryContentKindColumn()
			|| $this->missingGroupingColumns()
			|| $this->missingUiSortColumn();

		if (!$needsMigrate) {
			// Schema complete — but rows scanned before collection_folder
			// existed may still be NULL (migrations only add columns, the
			// backfill lives here). Repair must backfill regardless.
			$this->backfillCollectionFolder($output);
			$output->info('AudioCheck: all ' . count(SchemaTableCatalog::EXPECTED_TABLES) . ' tables are present.');
			return;
		}

		if ($missingBefore !== []) {
			$output->info(sprintf(
				'AudioCheck: %d table(s) missing (%s); running pending migrations.',
				count($missingBefore),
				implode(', ', $missingBefore),
			));
		} else {
			$output->info('AudioCheck: library content_kind column missing; running pending migrations.');
		}

		$migrationService = new MigrationService(
			AudioCheckTableCatalog::APP_ID,
			Server::get(Connection::class),
		);
		$migrationService->migrate('latest', false);

		$missingAfter = $this->missingTables();
		if ($missingAfter !== [] || $this->missingLibraryContentKindColumn() || $this->missingGroupingColumns() || $this->missingUiSortColumn()) {
			throw new \RuntimeException(sprintf(
				'AudioCheck schema is still incomplete after migrate("latest"). Missing tables: %s; content_kind: %s; grouping columns: %s; ui_sort: %s.',
				$missingAfter === [] ? 'none' : implode(', ', $missingAfter),
				$this->missingLibraryContentKindColumn() ? 'missing' : 'ok',
				$this->missingGroupingColumns() ? 'missing' : 'ok',
				$this->missingUiSortColumn() ? 'missing' : 'ok',
			));
		}

		$this->backfillCollectionFolder($output);

		$output->info('AudioCheck: schema repair completed; all tables and columns are now present.');
	}

	private function missingGroupingColumns(): bool
	{
		$schema = new SchemaWrapper(Server::get(Connection::class));
		if ($schema->hasTable('ac_libraries') && !$schema->getTable('ac_libraries')->hasColumn('group_by_folder')) {
			return true;
		}
		if ($schema->hasTable('ac_tracks') && !$schema->getTable('ac_tracks')->hasColumn('collection_folder')) {
			return true;
		}
		return false;
	}

	private function missingUiSortColumn(): bool
	{
		$schema = new SchemaWrapper(Server::get(Connection::class));
		return $schema->hasTable('ac_playlists') && !$schema->getTable('ac_playlists')->hasColumn('ui_sort');
	}

	/** Fill collection_folder for rows scanned before the column existed. */
	private function backfillCollectionFolder(IOutput $output): void
	{
		if (!$this->connection->tableExists('ac_tracks')) {
			return;
		}
		$schema = new SchemaWrapper(Server::get(Connection::class));
		if (!$schema->hasTable('ac_tracks') || !$schema->getTable('ac_tracks')->hasColumn('collection_folder')) {
			return;
		}
		$qb = $this->connection->getQueryBuilder();
		$qb->select('id', 'rel_path')->from('ac_tracks')
			->where($qb->expr()->isNull('collection_folder'));
		$result = $qb->executeQuery();
		$updated = 0;
		$uq = $this->connection->getQueryBuilder();
		while ($row = $result->fetch()) {
			$uq->update('ac_tracks')
				->set('collection_folder', $uq->createNamedParameter(
					\OCA\AudioCheck\Util\CollectionFolder::fromRelPath((string)$row['rel_path'])
				))
				->where($uq->expr()->eq('id', $uq->createNamedParameter((int)$row['id'], \PDO::PARAM_INT)))
				->executeStatement();
			$updated++;
		}
		$result->closeCursor();
		if ($updated > 0) {
			$output->info(sprintf('AudioCheck: backfilled collection_folder for %d track(s).', $updated));
		}
	}

	/** @return list<string> */
	private function missingTables(): array
	{
		$missing = [];
		foreach (SchemaTableCatalog::EXPECTED_TABLES as $table) {
			if (!$this->connection->tableExists($table)) {
				$missing[] = $table;
			}
		}
		return $missing;
	}

	private function ensureBackgroundJobs(IOutput $output): void
	{
		if (!$this->jobList->has(ScanSchedulerJob::class, null)) {
			$this->jobList->add(ScanSchedulerJob::class, null);
			$output->info('AudioCheck: registered ScanSchedulerJob background job.');
		}
	}

	private function missingLibraryContentKindColumn(): bool
	{
		if (!$this->connection->tableExists('ac_libraries')) {
			return false;
		}
		$schema = new SchemaWrapper(Server::get(Connection::class));
		if (!$schema->hasTable('ac_libraries')) {
			return false;
		}
		return !$schema->getTable('ac_libraries')->hasColumn('content_kind');
	}
}
