<?php

declare(strict_types=1);

namespace OCA\AudioCheck\BackgroundJob;

use OCA\AudioCheck\Service\ScanService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/**
 * Staggered background library scans — one user bucket per run to avoid scan storms.
 */
class ScanSchedulerJob extends TimedJob
{
	private const BUCKET_COUNT = 24;

	public function __construct(
		ITimeFactory $time,
		private ScanService $scan,
	) {
		parent::__construct($time);
		$this->setInterval(3600);
	}

	protected function run($argument): void
	{
		$hour = (int)date('G');
		$bucket = $hour % self::BUCKET_COUNT;
		$this->scan->scheduleDueScans($bucket, self::BUCKET_COUNT);
	}
}
