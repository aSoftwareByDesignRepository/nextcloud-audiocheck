<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Repair;

use OC\DB\Connection;
use OC\DB\MigrationService;
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
		$needsMigrate = $missingBefore !== [] || $this->missingLibraryContentKindColumn();

		if (!$needsMigrate) {
			$output->info('AudioCheck: all ' . count(AudioCheckTableCatalog::TABLES) . ' tables are present.');
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
		if ($missingAfter !== [] || $this->missingLibraryContentKindColumn()) {
			throw new \RuntimeException(sprintf(
				'AudioCheck schema is still incomplete after migrate("latest"). Missing tables: %s; content_kind: %s.',
				$missingAfter === [] ? 'none' : implode(', ', $missingAfter),
				$this->missingLibraryContentKindColumn() ? 'missing' : 'ok',
			));
		}

		$output->info('AudioCheck: schema repair completed; all tables and columns are now present.');
	}

	/** @return list<string> */
	private function missingTables(): array
	{
		$missing = [];
		foreach (AudioCheckTableCatalog::TABLES as $table) {
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
		$schema = $this->connection->createSchema();
		if (!$schema->hasTable('ac_libraries')) {
			return false;
		}
		return !$schema->getTable('ac_libraries')->hasColumn('content_kind');
	}
}
