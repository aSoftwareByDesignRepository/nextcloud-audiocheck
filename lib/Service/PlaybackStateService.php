<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use OCP\IDBConnection;

class PlaybackStateService
{
	/** @var list<int> */
	public const SPEED_PRESETS = [75, 100, 125, 150, 175, 200];

	public function __construct(
		private IDBConnection $db,
		private FileAccessService $fileAccess,
		private ITimeFactory $timeFactory,
		private IConfig $config,
	) {
	}

	/** @return list<array<string, mixed>> */
	public function getContinueListening(string $userId, int $limit = 20): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('ps.*', 'm.title', 'm.artist', 'm.album', 'm.duration_ms', 'm.kind', 'm.cover_state', 'm.mimetype')
			->from('ac_play_state', 'ps')
			->leftJoin('ps', 'ac_tracks', 't', $qb->expr()->andX(
				$qb->expr()->eq('t.user_id', 'ps.user_id'),
				$qb->expr()->eq('t.file_id', 'ps.file_id'),
			))
			->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
			->where($qb->expr()->eq('ps.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('ps.finished', $qb->createNamedParameter(0, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->gt('ps.position_ms', $qb->createNamedParameter(0, \PDO::PARAM_INT)))
			->orderBy('ps.updated_at', 'DESC')
			->setMaxResults($limit);
		$result = $qb->executeQuery();
		$items = [];
		while ($row = $result->fetch()) {
			$fileId = (int)$row['file_id'];
			if (!$this->fileAccess->isFileAccessible($userId, $fileId)) {
				continue;
			}
			$items[] = $this->formatProgress($row, $userId);
		}
		$result->closeCursor();
		return $items;
	}

	public function getProgress(string $userId, ?int $fileId = null): array
	{
		if ($fileId !== null) {
			$row = $this->findProgress($userId, $fileId);
			if ($row === null) {
				throw new NotFoundException();
			}
			return $this->formatProgress($row, $userId);
		}
		return ['continue' => $this->getContinueListening($userId)];
	}

	public function saveProgress(string $userId, int $fileId, int $positionMs, int $speed, bool $finished, int $durationMs, ?int $clientUpdatedAt = null): array
	{
		$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
		$speed = $this->clampSpeed($speed);
		if ($durationMs <= 0) {
			$durationMs = max(0, $file->getSize() > 0 ? 0 : 0);
		}
		$positionMs = max(0, min($positionMs, $durationMs > 0 ? $durationMs : PHP_INT_MAX));

		if ($durationMs > 0 && $positionMs >= $durationMs - 3000) {
			$finished = true;
		}

		$now = $this->timeFactory->getTime();
		$existing = $this->findProgress($userId, $fileId);
		if ($existing !== null) {
			$lastAt = (int)$existing['updated_at'];
			$lastPos = (int)$existing['position_ms'];
			// T5.01: de-duplicate rapid beacons (unload + interval firing together).
			if (!$finished && ($now - $lastAt) < 3 && abs($positionMs - $lastPos) < 500) {
				return $this->formatProgress($existing, $userId);
			}
			// T5.01: reject stale writes from a slower device (allow finished + forward seeks).
			if ($clientUpdatedAt !== null && $clientUpdatedAt > 0 && $clientUpdatedAt < $lastAt && !$finished) {
				if ($positionMs < $lastPos - 3000) {
					return $this->formatProgress($existing, $userId);
				}
				if (abs($positionMs - $lastPos) < 500) {
					return $this->formatProgress($existing, $userId);
				}
				if ($positionMs <= $lastPos + 3000) {
					return $this->formatProgress($existing, $userId);
				}
			}
			$qb = $this->db->getQueryBuilder();
			$qb->update('ac_play_state')
				->set('position_ms', $qb->createNamedParameter($positionMs, \PDO::PARAM_INT))
				->set('duration_ms', $qb->createNamedParameter($durationMs, \PDO::PARAM_INT))
				->set('playback_speed', $qb->createNamedParameter($speed, \PDO::PARAM_INT))
				->set('finished', $qb->createNamedParameter($finished ? 1 : 0, \PDO::PARAM_INT))
				->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
				->where($qb->expr()->eq('id', $qb->createNamedParameter((int)$existing['id'], \PDO::PARAM_INT)));
			$qb->executeStatement();
		} else {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_play_state')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
					'position_ms' => $qb->createNamedParameter($positionMs, \PDO::PARAM_INT),
					'duration_ms' => $qb->createNamedParameter($durationMs, \PDO::PARAM_INT),
					'playback_speed' => $qb->createNamedParameter($speed, \PDO::PARAM_INT),
					'finished' => $qb->createNamedParameter($finished ? 1 : 0, \PDO::PARAM_INT),
					'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
		}

		$row = $this->findProgress($userId, $fileId);
		return $this->formatProgress($row ?? [], $userId);
	}

	public function deleteProgress(string $userId, int $fileId): void
	{
		$this->fileAccess->resolveReadableFile($userId, $fileId);
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_play_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	public function getDefaultSpeed(string $userId): int
	{
		$raw = $this->config->getUserValue($userId, Application::APP_ID, 'default_speed', '');
		if ($raw === '' || $raw === '0') {
			return 100;
		}

		return $this->clampSpeed((int)$raw);
	}

	public function saveDefaultSpeed(string $userId, int $speed): void
	{
		$this->config->setUserValue($userId, Application::APP_ID, 'default_speed', (string)$this->clampSpeed($speed));
	}

	public function getDefaultVolume(string $userId): int
	{
		$value = (int)$this->config->getUserValue($userId, Application::APP_ID, 'default_volume', '100');

		return $this->clampVolume($value);
	}

	public function saveDefaultVolume(string $userId, int $volume): void
	{
		$this->config->setUserValue($userId, Application::APP_ID, 'default_volume', (string)$this->clampVolume($volume));
	}

	public function clampVolume(int $volume): int
	{
		return max(0, min(100, $volume));
	}

	public function clampSpeed(int $speed): int
	{
		if (in_array($speed, self::SPEED_PRESETS, true)) {
			return $speed;
		}
		if ($speed <= 0) {
			return 100;
		}

		return max(50, min(300, $speed));
	}

	/** @return array<string, mixed>|null */
	private function findProgress(string $userId, int $fileId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('ps.*', 'm.title', 'm.artist', 'm.album', 'm.kind', 'm.cover_state', 'm.mimetype')
			->from('ac_play_state', 'ps')
			->leftJoin('ps', 'ac_tracks', 't', $qb->expr()->andX(
				$qb->expr()->eq('t.user_id', 'ps.user_id'),
				$qb->expr()->eq('t.file_id', 'ps.file_id'),
			))
			->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
			->where($qb->expr()->eq('ps.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('ps.file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	/** @param array<string, mixed> $row */
	private function formatProgress(array $row, string $userId = ''): array
	{
		$fileId = (int)($row['file_id'] ?? 0);
		$title = (string)($row['title'] ?? '');
		$artist = (string)($row['artist'] ?? '');
		if ($title === '' && $userId !== '' && $fileId > 0) {
			try {
				$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
				$base = pathinfo($file->getName(), PATHINFO_FILENAME);
				$title = $base !== '' ? $base : $file->getName();
			} catch (NotFoundException) {
				$title = '';
			}
		}
		return [
			'fileId' => $fileId,
			'positionMs' => (int)($row['position_ms'] ?? 0),
			'durationMs' => (int)($row['duration_ms'] ?? 0),
			'playbackSpeed' => $this->clampSpeed((int)($row['playback_speed'] ?? 100)),
			'finished' => (int)($row['finished'] ?? 0) === 1,
			'updatedAt' => (int)($row['updated_at'] ?? 0),
			'title' => $title,
			'artist' => $artist,
			'album' => (string)($row['album'] ?? ''),
			'kind' => (string)($row['kind'] ?? 'music'),
			'mimetype' => (string)($row['mimetype'] ?? ''),
			'browserPlayable' => $this->isBrowserPlayableMime((string)($row['mimetype'] ?? '')),
		];
	}

	private function isBrowserPlayableMime(string $mime): bool
	{
		$mime = trim($mime);
		if ($mime === '') {
			return true;
		}

		return $this->fileAccess->isLikelyBrowserPlayable($mime);
	}
}
