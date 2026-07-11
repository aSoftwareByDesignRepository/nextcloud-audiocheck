<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\Exception\NotFoundException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DBException;
use OCP\IDBConnection;

/**
 * Durable, server-side playback queue: one active queue per user.
 *
 * Stores only the queue ordering, the current pointer, and playback settings
 * (speed / shuffle / repeat). The exact resume position is intentionally read
 * from {@see PlaybackStateService} (ac_play_state) so there is a single source
 * of truth for "where did I leave off" — already hardened against stale/rapid
 * writes (T5.01).
 *
 * Security model: a stored file id is just an integer the user curated. All
 * authorization happens on read/use — {@see getQueue()} resolves every item via
 * {@see LibraryService::getPlayableTrack()} (which calls
 * {@see FileAccessService::resolveReadableFile()}) and marks anything the user
 * can no longer access as unavailable, never leaking foreign metadata.
 */
class PlayQueueService
{
	/** Hard cap on persisted items to bound DB writes; larger queues stay local-only. */
	public const MAX_ITEMS = 2000;

	/** @var list<string> */
	private const REPEAT_MODES = ['off', 'one', 'all'];

	public function __construct(
		private IDBConnection $db,
		private LibraryService $library,
		private PlaybackStateService $playback,
		private ITimeFactory $timeFactory,
	) {
	}

	/**
	 * @return array{items:list<array<string,mixed>>,currentIndex:int,positionMs:int,progressUpdatedAt:int,playbackSpeed:int,shuffle:bool,repeatMode:string,updatedAt:int}
	 */
	public function getQueue(string $userId): array
	{
		$queue = $this->findQueue($userId);
		if ($queue === null) {
			return $this->emptyQueue();
		}

		$fileIds = $this->loadItemFileIds((int)$queue['id']);
		if ($fileIds === []) {
			return $this->emptyQueue();
		}

		$items = [];
		foreach ($fileIds as $fileId) {
			$items[] = $this->resolveItem($userId, $fileId);
		}

		$count = count($items);
		$currentIndex = (int)$queue['current_index'];
		if ($currentIndex < 0 || $currentIndex >= $count) {
			$currentIndex = 0;
		}

		$positionMs = 0;
		$progressUpdatedAt = 0;
		$current = $items[$currentIndex];
		if (($current['unavailable'] ?? true) === false && (int)$current['fileId'] > 0) {
			try {
				$progress = $this->playback->getProgress($userId, (int)$current['fileId']);
				if (!empty($progress['finished'])) {
					$positionMs = 0;
				} else {
					$positionMs = max(0, (int)($progress['positionMs'] ?? 0));
				}
				$progressUpdatedAt = (int)($progress['updatedAt'] ?? 0);
			} catch (NotFoundException) {
				$positionMs = 0;
			}
		}

		return [
			'items' => $items,
			'currentIndex' => $currentIndex,
			'positionMs' => $positionMs,
			'progressUpdatedAt' => $progressUpdatedAt,
			'playbackSpeed' => $this->playback->clampSpeed((int)$queue['playback_speed']),
			'shuffle' => (int)$queue['shuffle'] === 1,
			'repeatMode' => $this->clampRepeat((string)$queue['repeat_mode']),
			'updatedAt' => (int)$queue['updated_at'],
		];
	}

	/**
	 * Persist the active queue. Items are only rewritten when the ordering
	 * actually changes, so frequent pointer/setting updates stay cheap.
	 *
	 * @param list<int|string> $fileIds
	 * @return array{updatedAt:int,count:int,stale?:bool}
	 */
	public function saveQueue(string $userId, array $fileIds, int $currentIndex, int $playbackSpeed, bool $shuffle, string $repeatMode, ?int $clientUpdatedAt = null): array
	{
		$clean = $this->sanitizeFileIds($fileIds);
		if ($clean === []) {
			$this->clearQueue($userId);
			return ['updatedAt' => 0, 'count' => 0];
		}

		$existing = $this->findQueue($userId);
		if ($existing !== null && $clientUpdatedAt !== null && $clientUpdatedAt > 0) {
			$lastAt = (int)$existing['updated_at'];
			if ($clientUpdatedAt < $lastAt) {
				$ids = $this->loadItemFileIds((int)$existing['id']);
				return ['updatedAt' => $lastAt, 'count' => count($ids), 'stale' => true];
			}
		}

		$count = count($clean);
		if ($currentIndex < 0 || $currentIndex >= $count) {
			$currentIndex = 0;
		}
		$speed = $this->playback->clampSpeed($playbackSpeed);
		$repeat = $this->clampRepeat($repeatMode);
		$now = $this->timeFactory->getTime();

		$this->db->beginTransaction();
		try {
			$existing = $this->findQueue($userId);
			if ($existing === null) {
				try {
					$queueId = $this->insertQueue($userId, $currentIndex, $speed, $shuffle, $repeat, $now);
				} catch (DBException $e) {
					// Two tabs saving simultaneously can both see "no queue" and
					// race on the user_id unique index; the loser updates instead.
					if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
						throw $e;
					}
					$this->db->rollBack();
					$this->db->beginTransaction();
					$row = $this->findQueue($userId);
					if ($row === null) {
						throw $e;
					}
					$queueId = (int)$row['id'];
					$this->updateQueue($queueId, $currentIndex, $speed, $shuffle, $repeat, $now);
				}
				$this->replaceItems($queueId, $clean);
			} else {
				$queueId = (int)$existing['id'];
				$this->updateQueue($queueId, $currentIndex, $speed, $shuffle, $repeat, $now);
				if ($this->loadItemFileIds($queueId) !== $clean) {
					$this->replaceItems($queueId, $clean);
				}
			}
			$this->db->commit();
		} catch (\Throwable $e) {
			$this->db->rollBack();
			throw $e;
		}

		return ['updatedAt' => $now, 'count' => $count];
	}

	public function clearQueue(string $userId): void
	{
		$existing = $this->findQueue($userId);
		if ($existing === null) {
			return;
		}
		$queueId = (int)$existing['id'];

		$this->db->beginTransaction();
		try {
			$this->deleteItems($queueId);
			$qb = $this->db->getQueryBuilder();
			$qb->delete('ac_queue')
				->where($qb->expr()->eq('id', $qb->createNamedParameter($queueId, \PDO::PARAM_INT)));
			$qb->executeStatement();
			$this->db->commit();
		} catch (\Throwable $e) {
			$this->db->rollBack();
			throw $e;
		}
	}

	/** Remove all queue data for a user (account deletion). */
	public function purgeUser(string $userId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')
			->from('ac_queue')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$ids = [];
		while ($row = $result->fetch()) {
			$ids[] = (int)$row['id'];
		}
		$result->closeCursor();

		foreach ($ids as $queueId) {
			$this->deleteItems($queueId);
		}

		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_queue')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	/**
	 * Resolve a single queue item; never throws and never leaks foreign metadata.
	 *
	 * @return array<string,mixed>
	 */
	private function resolveItem(string $userId, int $fileId): array
	{
		try {
			$track = $this->library->getPlayableTrack($userId, $fileId);
			$track['unavailable'] = false;
			return $track;
		} catch (NotFoundException) {
			return [
				'fileId' => $fileId,
				'title' => '',
				'fileName' => '',
				'artist' => '',
				'album' => '',
				'unavailable' => true,
			];
		}
	}

	private function currentPosition(string $userId, int $fileId): int
	{
		try {
			$progress = $this->playback->getProgress($userId, $fileId);
		} catch (NotFoundException) {
			return 0;
		}
		if (!empty($progress['finished'])) {
			return 0;
		}
		return max(0, (int)($progress['positionMs'] ?? 0));
	}

	/**
	 * @param list<int|string> $fileIds
	 * @return list<int>
	 */
	private function sanitizeFileIds(array $fileIds): array
	{
		$clean = [];
		foreach ($fileIds as $raw) {
			$id = (int)$raw;
			if ($id > 0) {
				$clean[] = $id;
			}
			if (count($clean) >= self::MAX_ITEMS) {
				break;
			}
		}
		return $clean;
	}

	/** @return array<string,mixed>|null */
	private function findQueue(string $userId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')
			->from('ac_queue')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->setMaxResults(1);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	/** @return list<int> */
	private function loadItemFileIds(int $queueId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id')
			->from('ac_queue_items')
			->where($qb->expr()->eq('queue_id', $qb->createNamedParameter($queueId, \PDO::PARAM_INT)))
			->orderBy('sort_order', 'ASC')
			->addOrderBy('id', 'ASC');
		$result = $qb->executeQuery();
		$ids = [];
		while ($row = $result->fetch()) {
			$ids[] = (int)$row['file_id'];
		}
		$result->closeCursor();
		return $ids;
	}

	private function insertQueue(string $userId, int $currentIndex, int $speed, bool $shuffle, string $repeat, int $now): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->insert('ac_queue')->values([
			'user_id' => $qb->createNamedParameter($userId),
			'current_index' => $qb->createNamedParameter($currentIndex, \PDO::PARAM_INT),
			'playback_speed' => $qb->createNamedParameter($speed, \PDO::PARAM_INT),
			'shuffle' => $qb->createNamedParameter($shuffle ? 1 : 0, \PDO::PARAM_INT),
			'repeat_mode' => $qb->createNamedParameter($repeat),
			'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
		]);
		$qb->executeStatement();
		return (int)$qb->getLastInsertId();
	}

	private function updateQueue(int $queueId, int $currentIndex, int $speed, bool $shuffle, string $repeat, int $now): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_queue')
			->set('current_index', $qb->createNamedParameter($currentIndex, \PDO::PARAM_INT))
			->set('playback_speed', $qb->createNamedParameter($speed, \PDO::PARAM_INT))
			->set('shuffle', $qb->createNamedParameter($shuffle ? 1 : 0, \PDO::PARAM_INT))
			->set('repeat_mode', $qb->createNamedParameter($repeat))
			->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($queueId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	/** @param list<int> $fileIds */
	private function replaceItems(int $queueId, array $fileIds): void
	{
		$this->deleteItems($queueId);
		$sort = 0;
		foreach ($fileIds as $fileId) {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_queue_items')->values([
				'queue_id' => $qb->createNamedParameter($queueId, \PDO::PARAM_INT),
				'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
				'sort_order' => $qb->createNamedParameter($sort, \PDO::PARAM_INT),
			]);
			$qb->executeStatement();
			$sort++;
		}
	}

	private function deleteItems(int $queueId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_queue_items')
			->where($qb->expr()->eq('queue_id', $qb->createNamedParameter($queueId, \PDO::PARAM_INT)));
		$qb->executeStatement();
	}

	private function clampRepeat(string $mode): string
	{
		return in_array($mode, self::REPEAT_MODES, true) ? $mode : 'off';
	}

	/**
	 * @return array{items:list<array<string,mixed>>,currentIndex:int,positionMs:int,progressUpdatedAt:int,playbackSpeed:int,shuffle:bool,repeatMode:string,updatedAt:int}
	 */
	private function emptyQueue(): array
	{
		return [
			'items' => [],
			'currentIndex' => 0,
			'positionMs' => 0,
			'progressUpdatedAt' => 0,
			'playbackSpeed' => 100,
			'shuffle' => false,
			'repeatMode' => 'off',
			'updatedAt' => 0,
		];
	}
}
