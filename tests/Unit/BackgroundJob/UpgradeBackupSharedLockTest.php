<?php

declare(strict_types=1);

/**
 * Contract proof for the upgrade-backup coordination contract:
 * UpgradeBackupService::restore() holds LOCK_KEY exclusively — every
 * BackgroundJob that scans/writes app tables must take the SHARED lock.
 * TimedJob skips on LockedException; QueuedJob re-queues itself so the
 * deferred work is not silently dropped; both always release.
 *
 * @copyright Copyright (c) 2026
 * @license AGPL-3.0-or-later
 */

namespace OCA\AudioCheck\Tests\Unit\BackgroundJob;

use OCA\AudioCheck\BackgroundJob\ScanJob;
use OCA\AudioCheck\BackgroundJob\ScanSchedulerJob;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UpgradeBackupService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class UpgradeBackupSharedLockTest extends TestCase
{
	/** Every app BackgroundJob — the whole family is wired into the contract. */
	private const JOB_CLASSES = [
		ScanJob::class,
		ScanSchedulerJob::class,
	];

	/**
	 * Static contract: every job class (a) declares an ILockingProvider
	 * constructor dependency and (b) its source acquires the shared lock on
	 * UpgradeBackupService::LOCK_KEY and releases it in a finally.
	 */
	public function testEveryJobIsWiredIntoSharedLockContract(): void
	{
		foreach (self::JOB_CLASSES as $class) {
			$ref = new \ReflectionClass($class);
			$ctor = $ref->getConstructor();
			$this->assertNotNull($ctor, $class);
			$hasLockDep = false;
			foreach ($ctor->getParameters() as $p) {
				$t = $p->getType();
				if ($t instanceof \ReflectionNamedType && $t->getName() === ILockingProvider::class) {
					$hasLockDep = true;
				}
			}
			$this->assertTrue($hasLockDep, "$class constructor lacks an ILockingProvider dependency");

			$file = $ref->getFileName();
			$this->assertNotFalse($file, $class);
			$src = (string)file_get_contents($file);
			$this->assertStringContainsString('UpgradeBackupService::LOCK_KEY', $src, $class);
			$this->assertStringContainsString('ILockingProvider::LOCK_SHARED', $src, $class);
			$this->assertStringContainsString('releaseLock(UpgradeBackupService::LOCK_KEY', $src, $class);
			$this->assertStringContainsString('} finally {', $src, $class);
		}
		// Sanity: the contract covers the whole BackgroundJob dir — no
		// silently missed class when a third job lands.
		$dir = dirname((string)(new \ReflectionClass(self::JOB_CLASSES[0]))->getFileName());
		$onDisk = [];
		foreach (glob($dir . '/*Job.php') ?: [] as $f) {
			$onDisk[] = 'OCA\\AudioCheck\\BackgroundJob\\' . basename($f, '.php');
		}
		sort($onDisk);
		$declared = self::JOB_CLASSES;
		sort($declared);
		$this->assertSame($onDisk, $declared, 'JOB_CLASSES must enumerate every *Job.php in lib/BackgroundJob');
	}

	private function invokeRun(object $job, $argument = null): void
	{
		$m = new \ReflectionMethod($job, 'run');
		$m->setAccessible(true);
		$m->invoke($job, $argument);
	}

	private function lockedProvider(): ILockingProvider
	{
		$locking = $this->createMock(ILockingProvider::class);
		$locking->method('acquireLock')
			->with(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED)
			->willThrowException(new LockedException('restore in progress'));
		return $locking;
	}

	public function testLockedOutSchedulerSkipsWithoutTouchingAppTables(): void
	{
		$scan = $this->createMock(ScanService::class);
		$scan->expects($this->never())->method('scheduleDueScans');

		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('warning')
			->with($this->stringContains('skipping'), $this->arrayHasKey('app'));

		$job = new ScanSchedulerJob(
			$this->createMock(ITimeFactory::class),
			$scan,
			$this->lockedProvider(),
			$logger,
		);
		$this->invokeRun($job);
	}

	public function testLockedOutQueuedScanDefersWithoutDoingWork(): void
	{
		// ScanJob is a QueuedJob — a skip would lose the queued work (the
		// oc_jobs row is already gone), so the job re-queues itself.
		$argument = ['userId' => 'u1'];
		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->once())->method('add')
			->with(ScanJob::class, $argument);

		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('warning')
			->with($this->stringContains('deferring'), $this->arrayHasKey('app'));

		$job = new ScanJob(
			$this->createMock(ITimeFactory::class),
			$jobList,
			$this->lockedProvider(),
			$logger,
		);
		$this->invokeRun($job, $argument);
	}

	public function testSharedLockIsReleasedWhenWorkThrows(): void
	{
		// acquire+release must bracket the work even when it blows up —
		// a leaked shared lock would starve the exclusive restore.
		$locking = $this->createMock(ILockingProvider::class);
		$locking->expects($this->once())->method('acquireLock')
			->with(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED, $this->isType('string'));
		$locking->expects($this->once())->method('releaseLock')
			->with(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED);

		$scan = $this->createMock(ScanService::class);
		$scan->method('scheduleDueScans')
			->willThrowException(new \RuntimeException('db gone'));

		$job = new ScanSchedulerJob(
			$this->createMock(ITimeFactory::class),
			$scan,
			$locking,
			$this->createMock(LoggerInterface::class),
		);
		$this->expectException(\RuntimeException::class);
		$this->invokeRun($job);
	}

	public function testHappyPathAcquiresAndReleasesSharedLock(): void
	{
		$locking = $this->createMock(ILockingProvider::class);
		$locking->expects($this->once())->method('acquireLock')
			->with(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED, $this->isType('string'));
		$locking->expects($this->once())->method('releaseLock')
			->with(UpgradeBackupService::LOCK_KEY, ILockingProvider::LOCK_SHARED);

		$scan = $this->createMock(ScanService::class);
		$scan->expects($this->once())->method('scheduleDueScans')
			->with($this->isType('int'), 24);

		$job = new ScanSchedulerJob(
			$this->createMock(ITimeFactory::class),
			$scan,
			$locking,
			$this->createMock(LoggerInterface::class),
		);
		$this->invokeRun($job);
	}
}
