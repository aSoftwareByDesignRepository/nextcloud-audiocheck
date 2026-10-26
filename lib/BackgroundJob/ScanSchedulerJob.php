<?php

declare(strict_types=1);

namespace OCA\AudioCheck\BackgroundJob;

use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UpgradeBackupService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use Psr\Log\LoggerInterface;

/**
 * Staggered background library scans — one user bucket per run to avoid scan storms.
 */
class ScanSchedulerJob extends TimedJob
{
	private const BUCKET_COUNT = 24;

	public function __construct(
		ITimeFactory $time,
		private ScanService $scan,
		private ILockingProvider $locking,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(3600);
	}

	protected function run($argument): void
	{
		// Shared lock on the upgrade-backup key: a restore holds it
		// exclusively (UpgradeBackupService::runExclusive) — app-table
		// scans/writes must not interleave with a mid-restore
		// wipe+reinsert. A skip is not a failure: TimedJobs re-run on
		// their interval.
		try {
			$this->locking->acquireLock(
				UpgradeBackupService::LOCK_KEY,
				ILockingProvider::LOCK_SHARED,
				'scan scheduler',
			);
		} catch (LockedException) {
			$this->logger->warning(
				'AudioCheck: skipping scan scheduler — upgrade backup/restore in progress.',
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
		$hour = (int)date('G');
		$bucket = $hour % self::BUCKET_COUNT;
		$this->scan->scheduleDueScans($bucket, self::BUCKET_COUNT);
	}
}
