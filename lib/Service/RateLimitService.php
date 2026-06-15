<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCP\IConfig;

class RateLimitService
{
	public function __construct(
		private IConfig $config,
	) {
	}

	public function assertAllowed(string $userId, string $action, int $max, int $windowSeconds): void
	{
		if ($userId === '') {
			throw new AccessDeniedException();
		}
		$key = 'rate_limit:' . $action . ':' . $userId;
		$now = time();
		$raw = (string)$this->config->getUserValue($userId, Application::APP_ID, $key, '[]');
		try {
			$timestamps = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			$timestamps = [];
		}
		if (!is_array($timestamps)) {
			$timestamps = [];
		}
		$cutoff = $now - $windowSeconds;
		$timestamps = array_values(array_filter(
			$timestamps,
			static fn ($ts): bool => is_int($ts) && $ts >= $cutoff,
		));
		if (count($timestamps) >= $max) {
			throw new RateLimitExceededException();
		}
		$timestamps[] = $now;
		$this->config->setUserValue($userId, Application::APP_ID, $key, json_encode($timestamps, JSON_THROW_ON_ERROR));
	}
}
