<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Util\SearchTextNormalizer;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\DB\Exception as DBException;
use OCP\DB\QueryBuilder\IQueryBuilder;
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

	/** Treat abandoned RUNNING rows as resumable (crash / timeout mid-batch). */
	private const STALE_RUNNING_SECONDS = 600;

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

	public function hasConfiguredLibraries(string $userId): bool
	{
		return $this->listLibraryRoots($userId) !== [];
	}

	/**
	 * Run scan batches in-process so "Scan now" works without waiting for background cron.
	 */
	public function runInteractiveScan(string $userId, int $maxSeconds = 25): void
	{
		if ($userId === '') {
			return;
		}
		$this->queueScan($userId);
		$deadline = $this->timeFactory->getTime() + max(5, $maxSeconds);
		do {
			$this->scanUser($userId);
			$status = $this->getStatus($userId);
		} while ($status['status'] !== self::STATUS_IDLE && $this->timeFactory->getTime() < $deadline);
	}

	/**
	 * Advance one queued scan batch when Nextcloud uses AJAX/webcron (poor man's cron).
	 */
	public function runAjaxCronScanBatch(string $userId): void
	{
		if ($userId === '' || $this->usesSystemCron()) {
			return;
		}
		$status = $this->getStatus($userId);
		if ($status['status'] === self::STATUS_IDLE) {
			return;
		}
		if ($status['status'] === self::STATUS_RUNNING && !$this->isStaleRunning($userId)) {
			return;
		}
		if ($status['status'] !== self::STATUS_QUEUED && $status['status'] !== self::STATUS_RUNNING) {
			return;
		}
		$this->scanUser($userId);
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

	/** @param array<string, mixed>|null $row */
	private function isStaleRunning(string $userId, ?array $row = null): bool
	{
		$row ??= $this->getScanRow($userId);
		if ($row === null || (string)($row['status'] ?? '') !== self::STATUS_RUNNING) {
			return false;
		}
		$updatedAt = (int)($row['updated_at'] ?? 0);
		if ($updatedAt < 1) {
			return true;
		}
		return ($this->timeFactory->getTime() - $updatedAt) >= self::STALE_RUNNING_SECONDS;
	}

	public function scanUser(string $userId): void
	{
		if ($userId === '') {
			return;
		}

		if (!$this->tryClaimScan($userId)) {
			return;
		}

		$scanRow = $this->getScanRow($userId);
		$now = $this->timeFactory->getTime();
		$cursor = $this->parseCursor($scanRow);
		$isResume = $cursor['scanGen'] > 0;
		$scanGen = $isResume ? $cursor['scanGen'] : $now;
		$rootIdx = $isResume ? $cursor['rootIdx'] : 0;
		$walkStack = $isResume ? $cursor['walkStack'] : [];

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
					'content_kind' => LibraryService::CONTENT_KIND_AUTO,
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
					$walkStack = [];
					continue;
				}
				$includeSub = (int)($root['include_subfolders'] ?? 1) === 1;
				if ($ri !== $rootIdx) {
					$walkStack = [];
				}
				do {
					$remaining = self::SCAN_BATCH_SIZE - $processed;
					$batch = $this->fileAccess->walkAudioFilesBatch($folder, $includeSub, $walkStack, $remaining);
					$walkStack = $batch['stack'];
					foreach ($batch['files'] as $node) {
						$this->upsertTrack(
							$userId,
							$node,
							(int)($root['id'] ?? 0),
							$scanGen,
							$now,
							false,
							(string)($root['content_kind'] ?? LibraryService::CONTENT_KIND_AUTO),
						);
						$processed++;
						if (($processed % 25) === 0) {
							$this->touchScanLease($userId);
						}
						if ($processed >= self::SCAN_BATCH_SIZE) {
							$this->saveCursor($userId, [
								'scanGen' => $scanGen,
								'rootIdx' => $ri,
								'walkStack' => $walkStack,
							]);
							$total = $this->countTracks($userId);
							$this->setStatus($userId, self::STATUS_QUEUED, null, null, $total);
							if (!$this->jobList->has(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId])) {
								$this->jobList->add(\OCA\AudioCheck\BackgroundJob\ScanJob::class, ['userId' => $userId]);
							}
							return;
						}
					}
				} while (!$batch['done']);
				$walkStack = [];
			}

			$this->pruneByScanGeneration($userId, $scanGen);
			$this->metadata->garbageCollectOrphans();
			$this->clearCursor($userId);

			$total = $this->countTracks($userId);
			$this->setStatus($userId, self::STATUS_IDLE, null, $now, $total);
		} catch (\Throwable $e) {
			$this->clearCursor($userId);
			$this->logger->error('AudioCheck scan failed', ['userId' => $userId, 'exception' => $e]);
			$this->setStatus($userId, self::STATUS_IDLE, mb_substr($e->getMessage(), 0, 1000));
		}
	}

	public function handleNodeEvent(string $userId, Node $node, string $event): void
	{
		if ($userId === '') {
			return;
		}
		if ($event === 'deleted') {
			$fileId = (int)$node->getId();
			$qb = $this->db->getQueryBuilder();
			$qb->delete('ac_tracks')
				->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
			$qb->executeStatement();
			$this->purgeFileReferences($userId, $fileId);
			return;
		}
		if ($node instanceof File && $this->fileAccess->isAllowedAudioFile($node)) {
			$now = $this->timeFactory->getTime();
			$library = $this->resolveLibraryForFile($userId, $node);
			$libraryId = $library !== null ? (int)($library['id'] ?? 0) : null;
			$contentKind = $library !== null
				? (string)($library['content_kind'] ?? LibraryService::CONTENT_KIND_AUTO)
				: LibraryService::CONTENT_KIND_AUTO;
			$this->upsertTrack($userId, $node, $libraryId !== null && $libraryId > 0 ? $libraryId : null, $now, $now, true, $contentKind);
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

	/** @return array<string, mixed>|null */
	private function resolveLibraryForFile(string $userId, File $file): ?array
	{
		$roots = $this->listLibraryRoots($userId);
		if ($roots === []) {
			return null;
		}
		$relPath = $file->getPath();
		$userHome = $this->fileAccess->getUserHomePath($userId);
		if (str_starts_with($relPath, $userHome)) {
			$relPath = substr($relPath, strlen($userHome));
		}
		if ($relPath === '' || $relPath[0] !== '/') {
			$relPath = '/' . ltrim($relPath, '/');
		}

		$best = null;
		$bestLen = -1;
		foreach ($roots as $root) {
			$folderPath = rtrim((string)($root['folder_path'] ?? '/'), '/');
			if ($folderPath === '' || $folderPath === '/') {
				if ($best === null) {
					$best = $root;
					$bestLen = 0;
				}
				continue;
			}
			$prefix = $folderPath . '/';
			if ($relPath === $folderPath || str_starts_with($relPath, $prefix)) {
				$len = strlen($folderPath);
				if ($len > $bestLen) {
					$bestLen = $len;
					$best = $root;
				}
			}
		}
		return $best;
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

	private function upsertTrack(string $userId, File $file, ?int $libraryId, int $scanGeneration, int $addedAt, bool $forceMetadata = false, string $libraryContentKind = LibraryService::CONTENT_KIND_AUTO): void
	{
		$resolved = $this->resolveLibraryForFile($userId, $file);
		if ($resolved !== null) {
			$resolvedId = (int)($resolved['id'] ?? 0);
			if ($resolvedId > 0) {
				$libraryId = $resolvedId;
			}
			$libraryContentKind = (string)($resolved['content_kind'] ?? LibraryService::CONTENT_KIND_AUTO);
		}
		$policyApplies = $libraryContentKind !== LibraryService::CONTENT_KIND_AUTO;
		try {
			$metaId = $this->metadata->analyzeFile($file, $forceMetadata || $policyApplies, $libraryContentKind);
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
			$this->updateTrackRow((int)$existing['id'], $file, $metaId, $relPath, $libraryId, $scanGeneration);
			return;
		}

		try {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_tracks')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'file_id' => $qb->createNamedParameter($file->getId(), \PDO::PARAM_INT),
					'meta_id' => $qb->createNamedParameter($metaId, $metaId === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
					'rel_path' => $qb->createNamedParameter($relPath),
					'file_name' => $qb->createNamedParameter($file->getName()),
					'file_name_norm' => $qb->createNamedParameter(SearchTextNormalizer::normalize($file->getName())),
					'mtime' => $qb->createNamedParameter($file->getMTime(), \PDO::PARAM_INT),
					'size' => $qb->createNamedParameter($file->getSize(), \PDO::PARAM_INT),
					'etag' => $qb->createNamedParameter($file->getEtag()),
					'library_id' => $qb->createNamedParameter($libraryId, $libraryId === null || $libraryId < 1 ? \PDO::PARAM_NULL : \PDO::PARAM_INT),
					'added_at' => $qb->createNamedParameter($addedAt, \PDO::PARAM_INT),
					'last_seen_at' => $qb->createNamedParameter($scanGeneration, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
		} catch (DBException $e) {
			// A file-event listener (NodeCreated/NodeWritten) and a scan batch
			// can index the same file concurrently; the (user_id, file_id)
			// unique index makes the loser retry as an update.
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			$existing = $this->findTrack($userId, $file->getId());
			if ($existing !== null) {
				$this->updateTrackRow((int)$existing['id'], $file, $metaId, $relPath, $libraryId, $scanGeneration);
			}
		}
	}

	private function updateTrackRow(int $trackId, File $file, ?int $metaId, string $relPath, ?int $libraryId, int $scanGeneration): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_tracks')
			->set('rel_path', $qb->createNamedParameter($relPath))
			->set('file_name', $qb->createNamedParameter($file->getName()))
			->set('file_name_norm', $qb->createNamedParameter(SearchTextNormalizer::normalize($file->getName())))
			->set('mtime', $qb->createNamedParameter($file->getMTime(), \PDO::PARAM_INT))
			->set('size', $qb->createNamedParameter($file->getSize(), \PDO::PARAM_INT))
			->set('etag', $qb->createNamedParameter($file->getEtag()))
			->set('library_id', $qb->createNamedParameter($libraryId, $libraryId === null || $libraryId < 1 ? \PDO::PARAM_NULL : \PDO::PARAM_INT))
			->set('last_seen_at', $qb->createNamedParameter($scanGeneration, \PDO::PARAM_INT));
		// A transient analyze failure must not unlink metadata another worker
		// just committed on the same file_id unique index.
		if ($metaId !== null) {
			$qb->set('meta_id', $qb->createNamedParameter($metaId, \PDO::PARAM_INT));
		}
		$qb->where($qb->expr()->eq('id', $qb->createNamedParameter($trackId, \PDO::PARAM_INT)));
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

	/** @param array<string, mixed>|null $row @return array{scanGen:int,rootIdx:int,walkStack:list<array{path:string,offset:int}>} */
	private function parseCursor(?array $row): array
	{
		if ($row === null || $row['cursor'] === null || (string)$row['cursor'] === '') {
			return ['scanGen' => 0, 'rootIdx' => 0, 'walkStack' => []];
		}
		try {
			$data = json_decode((string)$row['cursor'], true, 8, JSON_THROW_ON_ERROR);
			if (!is_array($data)) {
				return ['scanGen' => 0, 'rootIdx' => 0, 'walkStack' => []];
			}
			$walkStack = [];
			if (isset($data['walkStack']) && is_array($data['walkStack'])) {
				foreach ($data['walkStack'] as $frame) {
					if (!is_array($frame)) {
						continue;
					}
					$walkStack[] = [
						'path' => (string)($frame['path'] ?? ''),
						'offset' => max(0, (int)($frame['offset'] ?? 0)),
					];
				}
			}
			return [
				'scanGen' => (int)($data['scanGen'] ?? 0),
				'rootIdx' => (int)($data['rootIdx'] ?? 0),
				'walkStack' => $walkStack,
			];
		} catch (\JsonException) {
			return ['scanGen' => 0, 'rootIdx' => 0, 'walkStack' => []];
		}
	}

	/** @param array{scanGen:int,rootIdx:int,walkStack:list<array{path:string,offset:int}>} $cursor */
	private function saveCursor(string $userId, array $cursor): void
	{
		$json = json_encode($cursor, JSON_THROW_ON_ERROR);
		$row = $this->getScanRow($userId);
		if ($row === null) {
			$now = $this->timeFactory->getTime();
			try {
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
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				$row = $this->getScanRow($userId);
				if ($row === null) {
					throw $e;
				}
			}
			if ($row === null) {
				return;
			}
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

	/**
	 * Atomically claim a scan batch so only one worker runs per user.
	 */
	private function tryClaimScan(string $userId): bool
	{
		$now = $this->timeFactory->getTime();
		$staleBefore = $now - self::STALE_RUNNING_SECONDS;
		if ($this->claimScanWithUpdate($userId, $now, $staleBefore)) {
			return true;
		}

		$row = $this->getScanRow($userId);
		if ($row !== null) {
			return false;
		}

		try {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_scan_state')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'status' => $qb->createNamedParameter(self::STATUS_RUNNING),
					'last_full_scan_at' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
					'last_error' => $qb->createNamedParameter(null),
					'tracks_total' => $qb->createNamedParameter(0, \PDO::PARAM_INT),
					'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
			return true;
		} catch (DBException $e) {
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}

		return $this->claimScanWithUpdate($userId, $now, $staleBefore);
	}

	private function claimScanWithUpdate(string $userId, int $now, int $staleBefore): bool
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_scan_state')
			->set('status', $qb->createNamedParameter(self::STATUS_RUNNING))
			->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->in(
					'status',
					$qb->createNamedParameter(
						[self::STATUS_IDLE, self::STATUS_QUEUED],
						IQueryBuilder::PARAM_STR_ARRAY,
					),
				),
				$qb->expr()->andX(
					$qb->expr()->eq('status', $qb->createNamedParameter(self::STATUS_RUNNING)),
					$qb->expr()->lt('updated_at', $qb->createNamedParameter($staleBefore, \PDO::PARAM_INT)),
				),
			));

		return $qb->executeStatement() > 0;
	}

	private function touchScanLease(string $userId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_scan_state')
			->set('updated_at', $qb->createNamedParameter($this->timeFactory->getTime(), \PDO::PARAM_INT))
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('status', $qb->createNamedParameter(self::STATUS_RUNNING)));
		$qb->executeStatement();
	}

	private function setStatus(string $userId, string $status, ?string $error, ?int $lastScanAt = null, ?int $tracksTotal = null): void
	{
		$now = $this->timeFactory->getTime();
		$row = $this->getScanRow($userId);
		if ($row === null) {
			try {
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
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
				$row = $this->getScanRow($userId);
				if ($row === null) {
					throw $e;
				}
			}
			if ($row === null) {
				return;
			}
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

	private function purgeFileReferences(string $userId, int $fileId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_play_state')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();

		$qb = $this->db->getQueryBuilder();
		$qb->select('id')
			->from('ac_playlists')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$playlistIds = [];
		while ($row = $result->fetch()) {
			$playlistIds[] = (int)$row['id'];
		}
		$result->closeCursor();
		if ($playlistIds !== []) {
			$dq = $this->db->getQueryBuilder();
			$dq->delete('ac_playlist_items')
				->where($dq->expr()->in('playlist_id', $dq->createNamedParameter($playlistIds, IQueryBuilder::PARAM_INT_ARRAY)))
				->andWhere($dq->expr()->eq('file_id', $dq->createNamedParameter($fileId, \PDO::PARAM_INT)));
			$dq->executeStatement();
		}

		$qb = $this->db->getQueryBuilder();
		$qb->select('q.id')
			->from('ac_queue', 'q')
			->where($qb->expr()->eq('q.user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$queueIds = [];
		while ($row = $result->fetch()) {
			$queueIds[] = (int)$row['id'];
		}
		$result->closeCursor();
		if ($queueIds !== []) {
			$dq = $this->db->getQueryBuilder();
			$dq->delete('ac_queue_items')
				->where($dq->expr()->in('queue_id', $dq->createNamedParameter($queueIds, IQueryBuilder::PARAM_INT_ARRAY)))
				->andWhere($dq->expr()->eq('file_id', $dq->createNamedParameter($fileId, \PDO::PARAM_INT)));
			$dq->executeStatement();
		}
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
