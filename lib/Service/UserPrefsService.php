<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCP\IConfig;

class UserPrefsService
{
	public function __construct(
		private IConfig $config,
		private PlaybackStateService $playback,
	) {
	}

	public function getPrefs(string $userId): array
	{
		return [
			'defaultSpeed' => $this->playback->getDefaultSpeed($userId),
			'defaultVolume' => $this->playback->getDefaultVolume($userId),
			'resumeOnOpen' => $this->config->getUserValue($userId, Application::APP_ID, 'resume_on_open', '1') === '1',
			'scanSubfolders' => $this->config->getUserValue($userId, Application::APP_ID, 'scan_subfolders', '1') === '1',
			'listenedThresholdPercent' => $this->playback->getListenedThresholdPercent($userId),
			'mobile' => [
				'minApiVersion' => 1,
				'features' => [
					'offlineDownloads' => true,
					'chapters' => true,
					'playlists' => true,
					'librarySync' => true,
				],
			],
		];
	}

	public function savePrefs(string $userId, array $payload): array
	{
		if (isset($payload['defaultSpeed'])) {
			$this->playback->saveDefaultSpeed($userId, (int)$payload['defaultSpeed']);
		}
		if (isset($payload['defaultVolume'])) {
			$this->playback->saveDefaultVolume($userId, (int)$payload['defaultVolume']);
		}
		if (array_key_exists('resumeOnOpen', $payload)) {
			$this->config->setUserValue($userId, Application::APP_ID, 'resume_on_open', $payload['resumeOnOpen'] ? '1' : '0');
		}
		if (array_key_exists('scanSubfolders', $payload)) {
			$this->config->setUserValue($userId, Application::APP_ID, 'scan_subfolders', $payload['scanSubfolders'] ? '1' : '0');
		}
		if (isset($payload['listenedThresholdPercent'])) {
			$this->playback->saveListenedThresholdPercent($userId, (int)$payload['listenedThresholdPercent']);
		}
		return $this->getPrefs($userId);
	}
}
