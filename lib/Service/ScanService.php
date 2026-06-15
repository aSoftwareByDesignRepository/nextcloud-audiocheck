<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\IDBConnection;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

class ScanService
{
	public const STATUS_IDLE = 'idle';
	public const STATUS_QUEUED = 'queued';
	public const STATUS_RUNNING = 'running';

	/** Files indexed per background job tick (resume via ac_scan_state.cursor). */
	public const SCAN_BATCH_SIZE = 250;

	public function __construct(
		private IDBConnection $db,
		private FileAccessService $fileAccess,
		private MetadataService $metadata,
		private CoverService $cover,
		private ITimeFactory $timeFactory,
		private IJobList $jobList,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function queueScan(string $userId): void
	{
		$current = $this->getStatus($userId);
		if ($current['status'] === self::STATUS_RUNNING || $current['status'] === self::STATUS_QUEUED) {
			return;
		}
		if ($this->jobList->has(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId])) {
			$this->setStatus($userId, self::STATUS_QUEUED, null);
			return;
		}
		$this->setStatus($userId, self::STATUS_QUEUED, null);
		$this->jobList->add(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId]);
	}

	public function getStatus(string $userId): array
	{
		$row = $this->getScanRow($userId);
		if ($row === null) {
			return $this->formatScanStatus(null);
		}
		return $this->formatScanStatus($row);
	}

	/** @param array<string, mixed>|null $row @return array<string, mixed> */
	private function formatScanStatus(?array $row): array
	{
		return [
			'status' => $row !== null ? (string)$row['status'] : self::STATUS_IDLE,
			'lastFullScanAt' => $row !== null ? (int)$row['last_full_scan_at'] : 0,
			'lastError' => $row !== null && $row['last_error'] !== null ? (string)$row['last_error'] : null,
			'tracksTotal' => $row !== null ? (int)$row['tracks_total'] : 0,
			'backgroundCron' => $this->usesSystemCron(),
		];
	}

	private function usesSystemCron(): bool
	{
		return $this->config->getAppValue('core', 'backgroundjobs_mode', 'ajax') === 'cron';
	}

	public function scanUser(string $userId): void
	{
		if ($userId === '') {
			return;
		}

		$scanRow = $this->getScanRow($userId);
		$currentStatus = $scanRow !== null ? (string)$scanRow['status'] : self::STATUS_IDLE;
		if ($currentStatus === self::STATUS_RUNNING) {
			return;
		}

		$now = $this->timeFactory->getTime();
		$cursor = $this->parseCursor($scanRow);
		$isResume = $cursor['scanGen'] > 0;
		$scanGen = $isResume ? $cursor['scanGen'] : $now;
		$rootIdx = $isResume ? $cursor['rootIdx'] : 0;
		$fileOffset = $isResume ? $cursor['fileOffset'] : 0;

		$this->setStatus($userId, self::STATUS_RUNNING, null);
		$processed = 0;

		try {
			$roots = $this->listLibraryRoots($userId);
			if ($roots === []) {
				$defaultPath = trim($this->config->getAppValue(Application::APP_ID, AccessControlService::KEY_DEFAULT_LIBRARY_FOLDER, '/'), '/');
				$userFolder = $this->fileAccess->getFolderByRelativePath($userId, $defaultPath === '' ? '/' : '/' . $defaultPath);
				if ($userFolder === null) {
					$this->clearCursor($userId);
					$this->setStatus($userId, self::STATUS_IDLE, null, $now, 0);
					return;
				}
				$roots[] = [
					'id' => 0,
					'folder_path' => $defaultPath === '' ? '/' : '/' . $defaultPath,
					'root_file_id' => $userFolder->getId(),
					'include_subfolders' => $this->userWantsScanSubfolders($userId) ? 1 : 0,
				];
			}

			for ($ri = $rootIdx; $ri < count($roots); $ri++) {
				$root = $roots[$ri];
				if (!(int)($root['enabled'] ?? 1)) {
					continue;
				}
				$folder = $this->resolveRootFolder($userId, $root);
				if ($folder === null) {
					$libraryId = (int)($root['id'] ?? 0);
					if ($libraryId > 0) {
						$this->disableLibrary($userId, $libraryId);
					}
					continue;
				}
				$includeSub = (int)($root['include_subfolders'] ?? 1) === 1;
				$nodes = $this->fileAccess->listAudioFilesInFolder($folder, $includeSub);
				$startAt = ($ri === $rootIdx) ? $fileOffset : 0;
				for ($fi = $startAt; $fi < count($nodes); $fi++) {
					$node = $nodes[$fi];
					if (!($node instanceof File)) {
						continue;
					}
					if (!$this->fileAccess->isAllowedAudioMime($node->getMimeType())) {
						continue;
					}
					$this->upsertTrack($userId, $node, (int)($root['id'] ?? 0), $scanGen, $now);
					$processed++;
					if ($processed >= self::SCAN_BATCH_SIZE) {
						$this->saveCursor($userId, [
							'scanGen' => $scanGen,
							'rootIdx' => $ri,
							'fileOffset' => $fi + 1,
						]);
						$total = $this->countTracks($userId);
						$this->setStatus($userId, self::STATUS_QUEUED, null, null, $total);
						if (!$this->jobList->has(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId])) {
							$this->jobList->add(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId]);
						}
						return;
					}
				}
			}

			$this->pruneByScanGeneration($userId, $scanGen);
			$this->metadata->garbageCollectOrphans();
			$this->clearCursor($userId);

			$total = $this->countTracks($userId);
			$this->setStatus($userId, self::STATUS_IDLE, null, $now, $total);
		} catch (\Throwable $e) {
			$this->clearCursor($userId);
			$this->logger->error('AudioCheck scan failed', ['userId' => $userId, 'message' => $e->getMessage()]);
			$this->setStatus($userId, self::STATUS_IDLE, mb_substr($e->getMessage(), 0, 1000));
		}
	}

	public function handleNodeEvent(string $userId, Node $node, string $event): void
	{
		if ($userId === '') {
			return;
		}
		if ($event === 'deleted') {
			$qb = $this->db->getQueryBuilder();
			$qb->delete('ac_tracks')
				->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($node->getId(), \PDO::PARAM_INT)));
			$qb->executeStatement();
			return;
		}
		if ($node instanceof File && $this->fileAccess->isAllowedAudioMime($node->getMimeType())) {
			$now = $this->timeFactory->getTime();
			$this->upsertTrack($userId, $node, null, $now, $now, true);
		}
	}

	/** @return list<array<string, mixed>> */
	private function listLibraryRoots(string $userId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_libraries')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('enabled', $qb->createNamedParameter(1, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$rows = [];
		while ($row = $result->fetch()) {
			$rows[] = $row;
		}
		$result->closeCursor();
		return $rows;
	}

	/** @param array<string, mixed> $root */
	private function resolveRootFolder(string $userId, array $root): ?Folder
	{
		$rootFileId = (int)($root['root_file_id'] ?? 0);
		if ($rootFileId > 0) {
			try {
				return $this->fileAccess->resolveReadableFolder($userId, $rootFileId);
			} catch (NotFoundException) {
				return null;
			}
		}
		$path = (string)($root['folder_path'] ?? '/');
		return $this->fileAccess->getFolderByRelativePath($userId, $path);
	}

	private function upsertTrack(string $userId, File $file, ?int $libraryId, int $scanGeneration, int $addedAt, bool $forceMetadata = false): void
	{
		try {
			$metaId = $this->metadata->analyzeFile($file, $forceMetadata);
		} catch (\Throwable) {
			$metaId = null;
		}

		$relPath = $file->getPath();
		$userHome = $this->fileAccess->getUserHomePath($userId);
		if (str_starts_with($relPath, $userHome)) {
			$relPath = substr($relPath, strlen($userHome));
		}

		$existing = $this->findTrack($userId, $file->getId());
		if ($existing !== null) {
			$qb = $this->db->getQueryBuilder();
			$qb->update('ac_tracks')
				->set('meta_id', $qb->createNamedParameter($metaId, $metaId === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
				->set('rel_path', $qb->createNamedParameter($relPath))
				->set('file_name', $qb->createNamedParameter($file->getName()))
				->set('mtime', $qb->createNamedParameter($file->getMTime(), \PDO::PARAM_INT))
				->set('size', $qb->createNamedParameter($file->getSize(), \PDO::PARAM_INT))
				->set('etag', $qb->createNamedParameter($file->getEtag()))
				->set('library_id', $qb->createNamedParameter($libraryId, $libraryId === null || $libraryId < 1 ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
				->set('last_seen_at', $qb->createNamedParameter($scanGeneration, \PDO::PARAM_INT))
				->where($qb->expr()->eq('id', $qb->createNamedParameter((int)$existing['id'], \PDO::PARAM_INT)));
			$qb->executeStatement();
			return;
		}

		$qb = $this->db->getQueryBuilder();
		$qb->insert('ac_tracks')
			->values([
				'user_id' => $qb->createNamedParameter($userId),
				'file_id' => $qb->createNamedParameter($file->getId(), \PDO::PARAM_INT),
				'meta_id' => $qb->createNamedParameter($metaId, $metaId === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
				'rel_path' => $qb->createNamedParameter($relPath),
				'file_name' => $qb->createNamedParameter($file->getName()),
				'mtime' => $qb->createNamedParameter($file->getMTime(), \PDO::PARAM_INT),
				'size' => $qb->createNamedParameter($file->getSize(), \PDO::PARAM_INT),
				'etag' => $qb->createNamedParameter($file->getEtag()),
				'library_id' => $qb->createNamedParameter($libraryId, $libraryId === null || $libraryId < 1 ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
				'added_at' => $qb->createNamedParameter($addedAt, \PDO::PARAM_INT),
				'last_seen_at' => $qb->createNamedParameter($scanGeneration, \PDO::PARAM_INT),
			]);
		$qb->executeStatement();
	}

	private function pruneByScanGeneration(string $userId, int $scanGeneration): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'file_id', 'last_seen_at')
			->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$fileId = (int)$row['file_id'];
			$stale = (int)$row['last_seen_at'] < $scanGeneration;
			if (!$this->fileAccess->isFileAccessible($userId, $fileId) || $stale) {
				$dq = $this->db->getQueryBuilder();
				$dq->delete('ac_tracks')
					->where($dq->expr()->eq('id', $dq->createNamedParameter((int)$row['id'], \PDO::PARAM_INT)));
				$dq->executeStatement();
			}
		}
		$result->closeCursor();
	}

	/** @param array<string, mixed>|null $row @return array{scanGen:int,rootIdx:int,fileOffset:int} */
	private function parseCursor(?array $row): array
	{
		if ($row === null || $row['cursor'] === null || (string)$row['cursor'] === '') {
			return ['scanGen' => 0, 'rootIdx' => 0, 'fileOffset' => 0];
		}
		try {
			$data = json_decode((string)$row['cursor'], true, 8, JSON_THROW_ON_ERROR);
			if (!is_array($data)) {
				return ['scanGen' => 0, 'rootIdx' => 0, 'fileOffset' => 0];
			}
			return [
				'scanGen' => (int)($data['scanGen'] ?? 0),
				'rootIdx' => (int)($data['rootIdx'] ?? 0),
				'fileOffset' => (int)($data['fileOffset'] ?? 0),
			];
		} catch (\JsonException) {
			return ['scanGen' => 0, 'rootIdx' => 0, 'fileOffset' => 0];
		}
	}

	/** @param array{scanGen:int,rootIdx:int,fileOffset:int} $cursor */
	private function saveCursor(string $userId, array $cursor): void
	{
		$json = json_encode($cursor, JSON_THROW_ON_ERROR);
		$row = $this->getScanRow($userId);
		if ($row === null) {
			$now = $this->timeFactory->getTime();
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_scan_state')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'status' => $qb->createNamedParameter(self::STATUS_QUEUED),
					'last_full_scan_at' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
					'last_error' => $qb->createNamedParameter(null),
					'tracks_total' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
					'cursor' => $qb->createNamedParameter($json),
					'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_scan_state')
			->set('cursor', $qb->createNamedParameter($json))
			->set('updated_at', $qb->createNamedParameter($this->timeFactory->getTime(), \PDO::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	private function clearCursor(string $userId): void
	{
		$row = $this->getScanRow($userId);
		if ($row === null) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_scan_state')
			->set('cursor', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	/** @return array<string, mixed>|null */
	private function findTrack(string $userId, int $fileId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	private function countTracks(string $userId): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('*', 'c'))->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return (int)($row['c'] ?? 0);
	}

	/** @return array<string, mixed>|null */
	private function getScanRow(string $userId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_scan_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	private function setStatus(string $userId, string $status, ?string $error, ?int $lastScanAt = null, ?int $tracksTotal = null): void
	{
		$now = $this->timeFactory->getTime();
		$row = $this->getScanRow($userId);
		if ($row === null) {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_scan_state')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'status' => $qb->createNamedParameter($status),
					'last_full_scan_at' => $qb->createNamedParameter($lastScanAt ?? 0, \PDO::PARAM_INT),
					'last_error' => $qb->createNamedParameter($error),
					'tracks_total' => $qb->createNamedParameter($tracksTotal ?? 0, \PDO::PARAM_INT),
					'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
			return;
		}

		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_scan_state')
			->set('status', $qb->createNamedParameter($status))
			->set('last_error', $qb->createNamedParameter($error))
			->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT));
		if ($lastScanAt !== null) {
			$qb->set('last_full_scan_at', $qb->createNamedParameter($lastScanAt, \PDO::PARAM_INT));
		}
		if ($tracksTotal !== null) {
			$qb->set('tracks_total', $qb->createNamedParameter($tracksTotal, \PDO::PARAM_INT));
		}
		$qb->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	/**
	 * Queue scans for users in the current stagger bucket (used by ScanSchedulerJob).
	 */
	public function scheduleDueScans(int $bucket, int $bucketCount): void
	{
		if ($bucketCount < 1) {
			return;
		}
		$minInterval = 20 * 3600;
		$now = $this->timeFactory->getTime();
		foreach ($this->listDistinctScanUserIds() as $userId) {
			$slot = abs(crc32($userId)) % $bucketCount;
			if ($slot !== $bucket) {
				continue;
			}
			$status = $this->getStatus($userId);
			if ($status['status'] !== self::STATUS_IDLE) {
				continue;
			}
			if ($status['lastFullScanAt'] > 0 && ($now - $status['lastFullScanAt']) < $minInterval) {
				continue;
			}
			$this->queueScan($userId);
		}
	}

	/** @return list<string> */
	public function listDistinctScanUserIds(): array
	{
		$ids = [];
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('user_id')->from('ac_libraries');
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$uid = (string)($row['user_id'] ?? '');
			if ($uid !== '') {
				$ids[$uid] = true;
			}
		}
		$result->closeCursor();

		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('user_id')->from('ac_scan_state');
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$uid = (string)($row['user_id'] ?? '');
			if ($uid !== '') {
				$ids[$uid] = true;
			}
		}
		$result->closeCursor();

		return array_keys($ids);
	}

	public function purgeUserData(string $userId): void
	{
		foreach (['ac_libraries', 'ac_tracks', 'ac_play_state', 'ac_scan_state'] as $table) {
			$qb = $this->db->getQueryBuilder();
			$qb->delete($table)->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
			$qb->executeStatement();
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from('ac_playlists')->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$ids = [];
		while ($row = $result->fetch()) {
			$ids[] = (int)$row['id'];
		}
		$result->closeCursor();
		foreach ($ids as $playlistId) {
			$dq = $this->db->getQueryBuilder();
			$dq->delete('ac_playlist_items')->where($dq->expr()->eq('playlist_id', $dq->createNamedParameter($playlistId, \PDO::PARAM_INT)));
			$dq->executeStatement();
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_playlists')->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();

		try {
			$this->metadata->garbageCollectOrphans();
		} catch (\Throwable) {
			// non-fatal during purge
		}
	}

	private function userWantsScanSubfolders(string $userId): bool
	{
		return $this->config->getUserValue($userId, Application::APP_ID, 'scan_subfolders', '1') === '1';
	}

	private function disableLibrary(string $userId, int $libraryId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_libraries')
			->set('enabled', $qb->createNamedParameter(0, \PDO::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($libraryId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}
}
