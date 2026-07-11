<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\InternalErrorException;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DBException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IConfig;
use OCP\IDBConnection;

class PlaybackStateService
{
	/** @var list<int> 0.5×–4.0× in 0.25× steps (centi-multiplier) */
	public const SPEED_PRESETS = [50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400];

	public const DEFAULT_LISTENED_THRESHOLD_PERCENT = 95;

	/** Matches web/mobile “play all” caps for bulk listened mutations. */
	public const MAX_BULK_LISTENED = 500;

	/** Hard cap on fileIds accepted in one API request (chunked server-side). */
	public const MAX_BULK_LISTENED_REQUEST = 2000;

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
			->andWhere($qb->expr()->eq('ps.listened', $qb->createNamedParameter(0, \PDO::PARAM_INT)))
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
			if (!$this->fileAccess->isFileAccessible($userId, $fileId)) {
				throw new NotFoundException();
			}
			return $this->formatProgress($row, $userId);
		}
		return ['continue' => $this->getContinueListening($userId)];
	}

	public function saveProgress(string $userId, int $fileId, int $positionMs, int $speed, bool $finished, int $durationMs, ?int $clientUpdatedAt = null): array
	{
		$this->fileAccess->resolveReadableFile($userId, $fileId);
		$speed = $this->clampSpeed($speed);
		// Unknown duration stays 0: the threshold check below only runs for
		// a known duration, and the position clamp falls back to PHP_INT_MAX.
		$durationMs = max(0, $durationMs);
		$positionMs = max(0, min($positionMs, $durationMs > 0 ? $durationMs : PHP_INT_MAX));

		$listened = $finished;
		if ($durationMs > 0 && $positionMs >= $this->listenedThresholdMs($userId, $durationMs)) {
			$finished = true;
			$listened = true;
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
			$this->updateProgressRow((int)$existing['id'], $positionMs, $durationMs, $speed, $finished, $listened, $now);
		} else {
			try {
				$qb = $this->db->getQueryBuilder();
				$qb->insert('ac_play_state')
					->values([
						'user_id' => $qb->createNamedParameter($userId),
						'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
						'position_ms' => $qb->createNamedParameter($positionMs, \PDO::PARAM_INT),
						'duration_ms' => $qb->createNamedParameter($durationMs, \PDO::PARAM_INT),
						'playback_speed' => $qb->createNamedParameter($speed, \PDO::PARAM_INT),
						'finished' => $qb->createNamedParameter($finished ? 1 : 0, \PDO::PARAM_INT),
						'listened' => $qb->createNamedParameter($listened ? 1 : 0, \PDO::PARAM_INT),
						'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
					]);
				$qb->executeStatement();
			} catch (DBException $e) {
				// Unload beacon and interval save can race on the (user_id,
				// file_id) unique index; the loser retries as an update.
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				$existing = $this->findProgress($userId, $fileId);
				if ($existing !== null) {
					$this->updateProgressRow((int)$existing['id'], $positionMs, $durationMs, $speed, $finished, $listened, $now);
				}
			}
		}

		$row = $this->findProgress($userId, $fileId);
		if ($row === null) {
			throw new InternalErrorException('Progress save failed after retry.');
		}
		return $this->formatProgress($row, $userId);
	}

	private function updateProgressRow(int $rowId, int $positionMs, int $durationMs, int $speed, bool $finished, bool $listened, int $now): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_play_state')
			->set('position_ms', $qb->createNamedParameter($positionMs, \PDO::PARAM_INT))
			->set('duration_ms', $qb->createNamedParameter($durationMs, \PDO::PARAM_INT))
			->set('playback_speed', $qb->createNamedParameter($speed, \PDO::PARAM_INT))
			->set('finished', $qb->createNamedParameter($finished ? 1 : 0, \PDO::PARAM_INT))
			->set('listened', $qb->createNamedParameter($listened ? 1 : 0, \PDO::PARAM_INT))
			->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($rowId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteProgress(string $userId, int $fileId): void
	{
		// Users may reset progress after a share is revoked; the row is
		// user-owned and must be purgeable without live file access.
		if ($this->findProgress($userId, $fileId) === null) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_play_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	/**
	 * Mark many tracks listened/unlistened in one request. Each fileId is authorized individually.
	 *
	 * @param list<int> $fileIds
	 * @return array{updated:int,skipped:int}
	 */
	public function setListenedBulk(string $userId, array $fileIds, bool $listened): array
	{
		$fileIds = array_values(array_unique(array_filter(
			array_map(static fn (mixed $id): int => (int)$id, $fileIds),
			static fn (int $id): bool => $id > 0,
		)));
		if ($fileIds === []) {
			return ['updated' => 0, 'skipped' => 0];
		}
		if (count($fileIds) > self::MAX_BULK_LISTENED) {
			throw new ValidationException('Too many tracks in one request.');
		}

		$accessible = [];
		$skipped = 0;
		foreach ($fileIds as $fileId) {
			try {
				$this->fileAccess->resolveReadableFile($userId, $fileId);
				$accessible[] = $fileId;
			} catch (\Throwable) {
				$skipped++;
			}
		}
		if ($accessible === []) {
			return ['updated' => 0, 'skipped' => $skipped];
		}

		$now = $this->timeFactory->getTime();
		$flag = $listened ? 1 : 0;
		$defaultSpeed = $this->getDefaultSpeed($userId);

		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id')
			->from('ac_play_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->in('file_id', $qb->createNamedParameter($accessible, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$existing = [];
		while ($row = $result->fetch()) {
			$existing[] = (int)$row['file_id'];
		}
		$result->closeCursor();

		if ($existing !== []) {
			$qb = $this->db->getQueryBuilder();
			$qb->update('ac_play_state')
				->set('listened', $qb->createNamedParameter($flag, \PDO::PARAM_INT))
				->set('finished', $qb->createNamedParameter($flag, \PDO::PARAM_INT))
				->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
				->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->in('file_id', $qb->createNamedParameter($existing, IQueryBuilder::PARAM_INT_ARRAY)));
			$qb->executeStatement();
		}

		foreach (array_values(array_diff($accessible, $existing)) as $fileId) {
			try {
				$qb = $this->db->getQueryBuilder();
				$qb->insert('ac_play_state')
					->values([
						'user_id' => $qb->createNamedParameter($userId),
						'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
						'position_ms' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
						'duration_ms' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
						'playback_speed' => $qb->createNamedParameter($defaultSpeed, \PDO::PARAM_INT),
						'finished' => $qb->createNamedParameter($flag, \PDO::PARAM_INT),
						'listened' => $qb->createNamedParameter($flag, \PDO::PARAM_INT),
						'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
					]);
				$qb->executeStatement();
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				// Concurrent request created the row first; apply the flag to it.
				$this->applyListenedFlag($userId, $fileId, $flag, $now);
			}
		}

		return ['updated' => count($accessible), 'skipped' => $skipped];
	}

	/** @return array<string, mixed> */
	public function setListened(string $userId, int $fileId, bool $listened): array
	{
		$this->fileAccess->resolveReadableFile($userId, $fileId);
		$now = $this->timeFactory->getTime();
		$flag = $listened ? 1 : 0;
		$existing = $this->findProgress($userId, $fileId);
		if ($existing !== null) {
			$this->applyListenedFlag($userId, $fileId, $flag, $now);
		} else {
			try {
				$qb = $this->db->getQueryBuilder();
				$qb->insert('ac_play_state')
					->values([
						'user_id' => $qb->createNamedParameter($userId),
						'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
						'position_ms' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
						'duration_ms' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
						'playback_speed' => $qb->createNamedParameter($this->getDefaultSpeed($userId), \PDO::PARAM_INT),
						'finished' => $qb->createNamedParameter($flag, \PDO::PARAM_INT),
						'listened' => $qb->createNamedParameter($flag, \PDO::PARAM_INT),
						'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
					]);
				$qb->executeStatement();
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				$this->applyListenedFlag($userId, $fileId, $flag, $now);
			}
		}

		$row = $this->findProgress($userId, $fileId);
		return $this->formatProgress($row ?? [], $userId);
	}

	/** Set listened/finished on an existing row addressed by (user, file). */
	private function applyListenedFlag(string $userId, int $fileId, int $flag, int $now): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_play_state')
			->set('listened', $qb->createNamedParameter($flag, \PDO::PARAM_INT))
			->set('finished', $qb->createNamedParameter($flag, \PDO::PARAM_INT))
			->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	/**
	 * @param list<int> $fileIds
	 * @return array<int, bool>
	 */
	public function getListenedMap(string $userId, array $fileIds): array
	{
		$fileIds = array_values(array_unique(array_filter(array_map('intval', $fileIds), fn (int $id): bool => $id > 0)));
		if ($fileIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id', 'listened')
			->from('ac_play_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->in('file_id', $qb->createNamedParameter($fileIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$map = [];
		while ($row = $result->fetch()) {
			$map[(int)$row['file_id']] = (int)($row['listened'] ?? 0) === 1;
		}
		$result->closeCursor();
		return $map;
	}

	public function getListenedThresholdPercent(string $userId): int
	{
		$raw = (int)$this->config->getUserValue(
			$userId,
			Application::APP_ID,
			'listened_threshold_percent',
			(string)self::DEFAULT_LISTENED_THRESHOLD_PERCENT,
		);

		return max(50, min(100, $raw));
	}

	public function saveListenedThresholdPercent(string $userId, int $percent): void
	{
		$this->config->setUserValue(
			$userId,
			Application::APP_ID,
			'listened_threshold_percent',
			(string)max(50, min(100, $percent)),
		);
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

		return max(50, min(400, $speed));
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
			'listened' => (int)($row['listened'] ?? 0) === 1,
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

	private function listenedThresholdMs(string $userId, int $durationMs): int
	{
		return (int)floor($durationMs * $this->getListenedThresholdPercent($userId) / 100);
	}
}
