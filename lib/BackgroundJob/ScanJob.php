<?php

declare(strict_types=1);

namespace OCA\AudioCheck\BackgroundJob;

use OCA\AudioCheck\Service\ScanService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

class ScanJob extends QueuedJob
{
	public function __construct(ITimeFactory $time)
	{
		parent::__construct($time);
	}

	protected function run($argument): void
	{
		$userId = (string)($argument['userId'] ?? '');
		if ($userId === '') {
			return;
		}
		\OCP\Server::get(ScanService::class)->scanUser($userId);
	}
}
