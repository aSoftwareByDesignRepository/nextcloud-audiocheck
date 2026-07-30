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
			$fileId = $this->safeNodeId($node);
			if ($fileId === null) {
				return;
			}
			$this->deleteTrackForFile($userId, $fileId);
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

	/**
	 * Index maintenance after a rename/move.
	 *
	 * Same-storage moves keep file_id: upsert the target so rel_path/file_name update
	 * in place (preserves added_at). Cross-storage moves can change file_id: purge the
	 * source id then index the target. Non-audio targets drop any matching index rows
	 * so extension/path changes cannot leave stale tracks.
	 *
	 * Folder moves rewrite library folder_path + descendant track rel_path prefixes
	 * (Nextcloud only emits NodeRenamedEvent for the folder, not each child).
	 */
	public function handleRename(string $userId, Node $source, Node $target): void
	{
		if ($userId === '') {
			return;
		}

		if ($target instanceof Folder) {
			$this->rewritePathsAfterFolderMove($userId, $source, $target);
			return;
		}

		$sourceId = $this->safeNodeId($source);
		$targetId = $this->safeNodeId($target);

		if ($target instanceof File && $this->fileAccess->isAllowedAudioFile($target)) {
			if ($sourceId !== null && $targetId !== null && $sourceId !== $targetId) {
				$this->deleteTrackForFile($userId, $sourceId);
			}
			$this->handleNodeEvent($userId, $target, 'written');
			return;
		}

		// Non-audio file: drop any index rows for the involved file id(s).
		if ($sourceId !== null) {
			$this->deleteTrackForFile($userId, $sourceId);
		}
		if ($targetId !== null && $targetId !== $sourceId) {
			$this->deleteTrackForFile($userId, $targetId);
		}
	}

	/**
	 * Index maintenance after a copy. Source stays; only the new target is indexed.
	 * Folder copies index audio under the destination synchronously (bounded); only
	 * overflow queues a background scan — library_id is never left for "later".
	 */
	public function handleCopy(string $userId, Node $source, Node $target): void
	{
		if ($userId === '') {
			return;
		}

		if ($target instanceof File && $this->fileAccess->isAllowedAudioFile($target)) {
			$this->handleNodeEvent($userId, $target, 'written');
			return;
		}

		if ($target instanceof Folder) {
			$this->indexFolderIntoLibraries($userId, $target);
		}
	}

	/**
	 * @internal Overridable in unit tests (partial mock).
	 *
	 * Rewrites descendant paths, assigns library_id immediately from the new paths,
	 * then discovers previously unindexed audio under the moved folder (bounded).
	 */
	protected function rewritePathsAfterFolderMove(string $userId, Node $source, Node $target): void
	{
		$oldRel = $this->relativeUserPath($userId, $source);
		$newRel = $this->relativeUserPath($userId, $target);
		if ($oldRel === null || $newRel === null) {
			// Without both paths we cannot rewrite prefixes safely — full reconcile via scan.
			$this->queueScan($userId);
			return;
		}
		if ($oldRel === $newRel) {
			return;
		}

		$targetId = $this->safeNodeId($target);
		// Libraries first so track library_id resolution sees updated folder_path values.
		$this->rewriteLibraryPathPrefixes($userId, $oldRel, $newRel, $targetId);
		$this->rewriteTrackPathsAndLibraryIds($userId, $oldRel, $newRel);

		// Discover audio that entered a library via the move (no prior ac_tracks row).
		if ($target instanceof Folder) {
			$this->indexFolderIntoLibraries($userId, $target);
		}
	}

	/**
	 * Index audio under $folder when it intersects an enabled library.
	 * Completes synchronously up to SCAN_BATCH_SIZE files; queues a scan only if truncated.
	 */
	public function indexFolderIntoLibraries(string $userId, Folder $folder): void
	{
		if (!$this->folderIntersectsLibrary($userId, $folder)) {
			return;
		}
		if (!$this->indexAudioUnderFolder($userId, $folder, self::SCAN_BATCH_SIZE)) {
			$this->queueScan($userId);
		}
	}

	/**
	 * Walk $folder for allowed audio and upsert into the index.
	 *
	 * @return bool True when the walk finished; false when truncated at $limit (caller may queueScan).
	 * @internal Overridable in unit tests (partial mock).
	 */
	protected function indexAudioUnderFolder(string $userId, Folder $folder, int $limit): bool
	{
		if ($limit < 1) {
			return false;
		}
		$now = $this->timeFactory->getTime();
		$stack = [];
		$processed = 0;
		do {
			$remaining = $limit - $processed;
			if ($remaining < 1) {
				return false;
			}
			$batch = $this->fileAccess->walkAudioFilesBatch($folder, true, $stack, $remaining);
			$stack = $batch['stack'];
			foreach ($batch['files'] as $node) {
				$library = $this->resolveLibraryForFile($userId, $node);
				$libraryId = $library !== null ? (int)($library['id'] ?? 0) : null;
				$contentKind = $library !== null
					? (string)($library['content_kind'] ?? LibraryService::CONTENT_KIND_AUTO)
					: LibraryService::CONTENT_KIND_AUTO;
				$this->upsertTrack(
					$userId,
					$node,
					$libraryId !== null && $libraryId > 0 ? $libraryId : null,
					$now,
					$now,
					true,
					$contentKind,
				);
				$processed++;
			}
			if ($processed >= $limit && !$batch['done']) {
				return false;
			}
		} while (!$batch['done']);

		return true;
	}

	/**
	 * @return int Number of library rows updated
	 */
	private function rewriteLibraryPathPrefixes(string $userId, string $oldRel, string $newRel, ?int $targetFolderId): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'folder_path', 'root_file_id')
			->from('ac_libraries')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$updated = 0;
		while ($row = $result->fetch()) {
			$folderPath = (string)($row['folder_path'] ?? '');
			$rootId = isset($row['root_file_id']) ? (int)$row['root_file_id'] : 0;
			$nextPath = null;
			if ($targetFolderId !== null && $rootId === $targetFolderId) {
				$nextPath = $newRel;
			} elseif ($folderPath === $oldRel) {
				$nextPath = $newRel;
			} elseif ($oldRel !== '/' && str_starts_with($folderPath, $oldRel . '/')) {
				$nextPath = $newRel . substr($folderPath, strlen($oldRel));
			}
			if ($nextPath === null || $nextPath === $folderPath) {
				continue;
			}
			$uq = $this->db->getQueryBuilder();
			$uq->update('ac_libraries')
				->set('folder_path', $uq->createNamedParameter($nextPath))
				->where($uq->expr()->eq('id', $uq->createNamedParameter((int)$row['id'], \PDO::PARAM_INT)));
			$uq->executeStatement();
			$updated++;
		}
		$result->closeCursor();
		return $updated;
	}

	/**
	 * Rewrite descendant track paths and assign library_id from the new path immediately.
	 *
	 * @return int Number of track rows updated
	 * @internal Overridable in unit tests (partial mock).
	 */
	protected function rewriteTrackPathsAndLibraryIds(string $userId, string $oldRel, string $newRel): int
	{
		$roots = $this->listLibraryRoots($userId);
		$qb = $this->db->getQueryBuilder();
		$like = $this->db->escapeLikeParameter($oldRel) . '/%';
		$qb->select('id', 'rel_path', 'library_id')
			->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->eq('rel_path', $qb->createNamedParameter($oldRel)),
				$qb->expr()->like('rel_path', $qb->createNamedParameter($like)),
			))
			->orderBy('id', 'ASC');
		$result = $qb->executeQuery();
		$updated = 0;
		while ($row = $result->fetch()) {
			$rel = (string)$row['rel_path'];
			$next = $rel === $oldRel
				? $newRel
				: $newRel . substr($rel, strlen($oldRel));
			$library = $this->resolveLibraryForRelPath($userId, $next, $roots);
			$libraryId = $library !== null ? (int)($library['id'] ?? 0) : null;
			if ($libraryId !== null && $libraryId < 1) {
				$libraryId = null;
			}
			$prevLibraryId = $row['library_id'] !== null && $row['library_id'] !== ''
				? (int)$row['library_id']
				: null;
			if ($next === $rel && $prevLibraryId === $libraryId) {
				continue;
			}
			$uq = $this->db->getQueryBuilder();
			$uq->update('ac_tracks')
				->set('rel_path', $uq->createNamedParameter($next))
				->set('library_id', $uq->createNamedParameter(
					$libraryId,
					$libraryId === null ? \PDO::PARAM_NULL : \PDO::PARAM_INT,
				))
				->where($uq->expr()->eq('id', $uq->createNamedParameter((int)$row['id'], \PDO::PARAM_INT)));
			$uq->executeStatement();
			$updated++;
		}
		$result->closeCursor();
		return $updated;
	}

	/** @internal Overridable in unit tests (partial mock). */
	protected function folderIntersectsLibrary(string $userId, Folder $target): bool
	{
		$rel = $this->relativeUserPath($userId, $target);
		if ($rel === null) {
			return true;
		}
		foreach ($this->listLibraryRoots($userId) as $root) {
			$folderPath = rtrim((string)($root['folder_path'] ?? '/'), '/');
			$includeSub = (int)($root['include_subfolders'] ?? 1) === 1;
			if ($folderPath === '' || $folderPath === '/') {
				return true;
			}
			// Folder is the library root, inside it, or contains it (library nested under moved tree).
			if ($rel === $folderPath || str_starts_with($folderPath, $rel . '/')) {
				return true;
			}
			if ($includeSub && str_starts_with($rel, $folderPath . '/')) {
				return true;
			}
			if (!$includeSub && $this->parentRelPath($rel) === $folderPath) {
				// Non-recursive library: only the library folder's direct child folders matter.
				return true;
			}
		}
		return false;
	}

	private function relativeUserPath(string $userId, Node $node): ?string
	{
		try {
			$path = $node->getPath();
		} catch (\Throwable) {
			return null;
		}
		if ($path === '') {
			return null;
		}
		$userHome = $this->fileAccess->getUserHomePath($userId);
		if ($userHome !== '' && str_starts_with($path, $userHome)) {
			$path = substr($path, strlen($userHome));
		}
		if ($path === '' || $path === '/') {
			return '/';
		}
		if ($path[0] !== '/') {
			$path = '/' . $path;
		}
		return rtrim($path, '/') ?: '/';
	}

	private function parentRelPath(string $relPath): string
	{
		$relPath = rtrim($relPath, '/');
		if ($relPath === '' || $relPath === '/') {
			return '/';
		}
		$pos = strrpos($relPath, '/');
		if ($pos === false) {
			return '/';
		}
		if ($pos === 0) {
			return '/';
		}
		return substr($relPath, 0, $pos) ?: '/';
	}

	/** @internal Overridable in unit tests (partial mock). */
	protected function deleteTrackForFile(string $userId, int $fileId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$qb->executeStatement();
		$this->purgeFileReferences($userId, $fileId);
	}

	protected function safeNodeId(Node $node): ?int
	{
		try {
			return (int)$node->getId();
		} catch (\Throwable) {
			return null;
		}
	}

	/**
	 * @return list<array<string, mixed>>
	 * @internal Overridable in unit tests (partial mock).
	 */
	protected function listLibraryRoots(string $userId): array
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
		$relPath = $file->getPath();
		$userHome = $this->fileAccess->getUserHomePath($userId);
		if ($userHome !== '' && str_starts_with($relPath, $userHome)) {
			$relPath = substr($relPath, strlen($userHome));
		}
		if ($relPath === '' || $relPath[0] !== '/') {
			$relPath = '/' . ltrim($relPath, '/');
		}
		$relPath = rtrim($relPath, '/') ?: '/';
		return $this->resolveLibraryForRelPath($userId, $relPath);
	}

	/**
	 * Pick the best enabled library root for a user-relative file path.
	 * Longest matching folder_path wins. Honours include_subfolders:
	 * when false, only files whose parent directory equals the library folder match.
	 *
	 * @param list<array<string, mixed>>|null $roots
	 * @return array<string, mixed>|null
	 */
	public function resolveLibraryForRelPath(string $userId, string $relPath, ?array $roots = null): ?array
	{
		$roots ??= $this->listLibraryRoots($userId);
		if ($roots === []) {
			return null;
		}
		if ($relPath === '' || $relPath[0] !== '/') {
			$relPath = '/' . ltrim($relPath, '/');
		}
		$relPath = rtrim($relPath, '/') ?: '/';
		$parent = $this->parentRelPath($relPath);

		$best = null;
		$bestLen = -1;
		foreach ($roots as $root) {
			$folderPath = rtrim((string)($root['folder_path'] ?? '/'), '/');
			$includeSub = (int)($root['include_subfolders'] ?? 1) === 1;
			if ($folderPath === '' || $folderPath === '/') {
				if ($best === null) {
					$best = $root;
					$bestLen = 0;
				}
				continue;
			}
			$matches = false;
			if ($includeSub) {
				$matches = $relPath === $folderPath || str_starts_with($relPath, $folderPath . '/');
			} else {
				// Non-recursive: file must live directly inside the library folder.
				$matches = $parent === $folderPath;
			}
			if (!$matches) {
				continue;
			}
			$len = strlen($folderPath);
			if ($len > $bestLen) {
				$bestLen = $len;
				$best = $root;
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
