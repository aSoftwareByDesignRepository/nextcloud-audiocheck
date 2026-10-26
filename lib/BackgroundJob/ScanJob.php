<?php

declare(strict_types=1);

namespace OCA\AudioCheck\BackgroundJob;

use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UpgradeBackupService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use Psr\Log\LoggerInterface;

class ScanJob extends QueuedJob
{
	public function __construct(
		ITimeFactory $time,
		private IJobList $jobList,
		private ILockingProvider $locking,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	protected function run($argument): void
	{
		// Shared lock on the upgrade-backup key: a restore holds it
		// exclusively (UpgradeBackupService::runExclusive) — app-table
		// writes must not interleave with a mid-restore wipe+reinsert.
		try {
			$this->locking->acquireLock(
				UpgradeBackupService::LOCK_KEY,
				ILockingProvider::LOCK_SHARED,
				'library scan',
			);
		} catch (LockedException) {
			// A skipped QueuedJob run leaves no oc_jobs row behind —
			// re-add so the deferred scan is not silently dropped.
			if (is_array($argument)) {
				$this->jobList->add(self::class, $argument);
			}
			$this->logger->warning(
				'AudioCheck: deferring library scan — upgrade backup/restore in progress.',
				['app' => 'audiocheck'],
			);
			return;
		}
		try {
			$this->doRun($argument);
		} finally {
			$this->locking->releaseLock(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED);
		}
	}

	private function doRun($argument): void
	{
		$userId = (string)($argument['userId'] ?? '');
		if ($userId === '') {
			return;
		}
		\OCP\Server::get(ScanService::class)->scanUser($userId);
	}
}
