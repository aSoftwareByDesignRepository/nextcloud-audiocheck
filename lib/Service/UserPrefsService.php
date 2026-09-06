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
			'showGlobalMiniPlayer' => $this->wantsGlobalMiniPlayer($userId),
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

	/**
	 * Whether the fixed mini-player may appear on Files / Photos / other apps.
	 * Default off — explicit opt-in so other apps keep an unobstructed bottom chrome.
	 */
	public function wantsGlobalMiniPlayer(string $userId): bool
	{
		return $this->config->getUserValue($userId, Application::APP_ID, 'show_global_mini_player', '0') === '1';
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
			$this->config->setUserValue(
				$userId,
				Application::APP_ID,
				'resume_on_open',
				self::coerceBool($payload['resumeOnOpen']) ? '1' : '0',
			);
		}
		if (array_key_exists('showGlobalMiniPlayer', $payload)) {
			$this->config->setUserValue(
				$userId,
				Application::APP_ID,
				'show_global_mini_player',
				self::coerceBool($payload['showGlobalMiniPlayer']) ? '1' : '0',
			);
		}
		if (array_key_exists('scanSubfolders', $payload)) {
			$this->config->setUserValue(
				$userId,
				Application::APP_ID,
				'scan_subfolders',
				self::coerceBool($payload['scanSubfolders']) ? '1' : '0',
			);
		}
		if (isset($payload['listenedThresholdPercent'])) {
			$this->playback->saveListenedThresholdPercent($userId, (int)$payload['listenedThresholdPercent']);
		}
		return $this->getPrefs($userId);
	}

	/**
	 * Strict boolean coercion for JSON/API clients.
	 * PHP's `(bool)"false"` is true — that must never flip an opt-in preference on.
	 */
	public static function coerceBool(mixed $value): bool
	{
		if (is_bool($value)) {
			return $value;
		}
		if (is_int($value) || is_float($value)) {
			return ((int)$value) === 1;
		}
		if ($value === null) {
			return false;
		}
		if (is_string($value)) {
			$normalized = strtolower(trim($value));
			if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
				return true;
			}
			if (in_array($normalized, ['0', 'false', 'no', 'off', ''], true)) {
				return false;
			}
			return false;
		}
		return false;
	}
}
