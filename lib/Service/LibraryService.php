<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Util\SearchTextNormalizer;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DBException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\QueryBuilder\IQueryFunction;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\IDBConnection;
use OCP\ITagManager;
use OCP\ITags;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use OCP\SystemTag\TagNotFoundException;

class LibraryService
{
	public const SORT_TITLE = 'title';
	public const SORT_ARTIST = 'artist';
	public const SORT_ADDED = 'added';
	public const SORT_PLAYED = 'played';

	public const KIND_MUSIC = 'music';
	public const KIND_AUDIOBOOK = 'audiobook';

	public const CONTENT_KIND_AUTO = 'auto';

	public function __construct(
		private IDBConnection $db,
		private FileAccessService $fileAccess,
		private ITimeFactory $timeFactory,
		private ITagManager $tagManager,
		private ISystemTagManager $systemTagManager,
		private ISystemTagObjectMapper $systemTagObjectMapper,
		private PlaybackStateService $playback,
	) {
	}

	/** @return list<array<string, mixed>> */
	public function listLibraries(string $userId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_libraries')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->orderBy('created_at', 'ASC');
		$result = $qb->executeQuery();
		$rows = [];
		while ($row = $result->fetch()) {
			$rows[] = $this->formatLibrary($row);
		}
		$result->closeCursor();
		return $rows;
	}

	public function addLibrary(string $userId, ?int $rootFileId, bool $includeSubfolders, string $contentKind = self::CONTENT_KIND_AUTO, ?string $folderPath = null): array
	{
		$contentKind = $this->normalizeContentKind($contentKind);
		$folder = $this->resolveLibraryFolder($userId, $rootFileId, $folderPath);
		$rootFileId = $folder->getId();
		$path = $folder->getPath();
		$userHome = $this->fileAccess->getUserHomePath($userId);
		if (str_starts_with($path, $userHome)) {
			$path = substr($path, strlen($userHome)) ?: '/';
		}

		$existing = $this->findLibraryByRootOrPath($userId, $rootFileId, $path);
		if ($existing !== null) {
			$result = $this->updateLibrary($userId, (int)$existing['id'], $includeSubfolders, $contentKind);
			return [
				'library' => $result['library'],
				'alreadyExisted' => true,
				'rescanRecommended' => $result['rescanRecommended'],
			];
		}

		$now = $this->timeFactory->getTime();
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('ac_libraries')
				->values([
					'user_id' => $qb->createNamedParameter($userId),
					'folder_path' => $qb->createNamedParameter($path),
					'root_file_id' => $qb->createNamedParameter($rootFileId, \PDO::PARAM_INT),
					'include_subfolders' => $qb->createNamedParameter($includeSubfolders ? 1 : 0, \PDO::PARAM_INT),
					'content_kind' => $qb->createNamedParameter($contentKind),
					'enabled' => $qb->createNamedParameter(1, \PDO::PARAM_INT),
					'created_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				]);
			$qb->executeStatement();
		} catch (DBException $e) {
			// Two tabs adding the same folder can race on (user_id, root_file_id).
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			$existing = $this->findLibraryByRootOrPath($userId, $rootFileId, $path);
			if ($existing === null) {
				throw $e;
			}
			$result = $this->updateLibrary($userId, (int)$existing['id'], $includeSubfolders, $contentKind);
			return [
				'library' => $result['library'],
				'alreadyExisted' => true,
				'rescanRecommended' => $result['rescanRecommended'],
			];
		}
		$id = (int)$this->db->lastInsertId('ac_libraries');
		return [
			'library' => $this->getLibrary($userId, $id),
			'alreadyExisted' => false,
			'rescanRecommended' => false,
		];
	}

	private function resolveLibraryFolder(string $userId, ?int $rootFileId, ?string $folderPath): Folder
	{
		if ($rootFileId !== null && $rootFileId > 0) {
			return $this->fileAccess->resolveReadableFolder($userId, $rootFileId);
		}
		if ($folderPath !== null && trim($folderPath) !== '') {
			return $this->fileAccess->resolveReadableFolderByRelativePath($userId, $folderPath);
		}
		throw new ValidationException('A valid folder is required.');
	}

	/** @return array<string, mixed>|null */
	private function findLibraryByRootOrPath(string $userId, int $rootFileId, string $path): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_libraries')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->eq('root_file_id', $qb->createNamedParameter($rootFileId, \PDO::PARAM_INT)),
				$qb->expr()->eq('folder_path', $qb->createNamedParameter($path)),
			))
			->setMaxResults(1);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row !== false ? $row : null;
	}

	public function removeLibrary(string $userId, int $libraryId): void
	{
		$this->assertLibraryOwned($userId, $libraryId);
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_libraries')
			->where($qb->expr()->eq('id', $qb->createNamedParameter($libraryId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	/**
	 * @return array{library:array<string,mixed>,rescanRecommended:bool}
	 */
	public function updateLibrary(string $userId, int $libraryId, ?bool $includeSubfolders, ?string $contentKind): array
	{
		$row = $this->assertLibraryOwned($userId, $libraryId);
		$rescanRecommended = false;
		$changed = false;
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_libraries')->where($qb->expr()->eq('id', $qb->createNamedParameter($libraryId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));

		if ($includeSubfolders !== null) {
			$previousSub = (int)($row['include_subfolders'] ?? 1) === 1;
			if ($includeSubfolders !== $previousSub) {
				$qb->set('include_subfolders', $qb->createNamedParameter($includeSubfolders ? 1 : 0, \PDO::PARAM_INT));
				$changed = true;
				$rescanRecommended = true;
			}
		}

		if ($contentKind !== null) {
			$normalized = $this->normalizeContentKind($contentKind);
			$previous = $this->normalizeContentKind((string)($row['content_kind'] ?? self::CONTENT_KIND_AUTO));
			if ($normalized !== $previous) {
				$qb->set('content_kind', $qb->createNamedParameter($normalized));
				$changed = true;
				if ($normalized === self::CONTENT_KIND_AUTO) {
					$rescanRecommended = true;
				}
			}
		}

		if ($changed) {
			$qb->executeStatement();
		}

		return [
			'library' => $this->getLibrary($userId, $libraryId),
			'rescanRecommended' => $rescanRecommended,
		];
	}

	public function normalizeContentKind(mixed $value): string
	{
		$raw = is_string($value) ? strtolower(trim($value)) : '';
		return match ($raw) {
			self::KIND_AUDIOBOOK, 'audiobooks' => self::KIND_AUDIOBOOK,
			self::KIND_MUSIC => self::KIND_MUSIC,
			self::CONTENT_KIND_AUTO, '' => self::CONTENT_KIND_AUTO,
			default => throw new ValidationException('Invalid content type.'),
		};
	}

	private function applyFixedContentKindToLibrary(string $userId, int $libraryId, string $kind): void
	{
		// Per-library content type is resolved at query time (see effectiveKindSql)
		// so shared ac_file_meta rows are never mutated across users.
	}

	public function getLibrary(string $userId, int $libraryId): array
	{
		$row = $this->assertLibraryOwned($userId, $libraryId);
		return $this->formatLibrary($row);
	}

	/**
	 * @return array{items:list<array<string,mixed>>,total:int,page:int,limit:int}
	 */
	public function listTracks(string $userId, ?string $kind, ?string $q, string $sort, int $page, int $limit, bool $favoritesOnly = false, ?int $tagId = null, ?string $genre = null, ?string $artist = null, ?string $series = null, ?string $folder = null, bool $hideListened = false): array
	{
		$page = max(1, $page);
		$limit = min(100, max(1, $limit));
		$offset = ($page - 1) * $limit;

		$qb = $this->db->getQueryBuilder();
		// Select columns only after the count clone below — NC QueryBuilder::clone is shallow
		// and select() on the clone would otherwise replace this query's column list too.
		$qb->from('ac_tracks', 't')
			->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
			->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)));
		$this->joinLibraryForEffectiveKind($qb);
		$this->applyEffectiveKindFilter($qb, $kind);
		$this->applySearchFilter($qb, ['m.title_norm', 'm.artist_norm', 'm.album_norm', 't.file_name_norm'], $q);
		if ($genre !== null && trim($genre) !== '') {
			$qb->andWhere($qb->expr()->eq('m.genre', $qb->createNamedParameter(trim($genre))));
		}
		if ($artist !== null && trim($artist) !== '') {
			$qb->andWhere($qb->expr()->eq('m.artist', $qb->createNamedParameter(trim($artist))));
		}
		if ($series !== null && trim($series) !== '') {
			$qb->andWhere($qb->expr()->eq('m.series', $qb->createNamedParameter(trim($series))));
		}
		if ($folder !== null && trim($folder) !== '') {
			$folderPath = rtrim(trim($folder), '/');
			$like = $this->db->escapeLikeParameter($folderPath) . '/%';
			$qb->andWhere($qb->expr()->like('t.rel_path', $qb->createNamedParameter($like)));
		}
		if ($favoritesOnly) {
			$favoriteIds = $this->loadFavoriteFileIds();
			if ($favoriteIds === []) {
				return ['items' => [], 'total' => 0, 'page' => $page, 'limit' => $limit];
			}
			$qb->andWhere($qb->expr()->in('t.file_id', $qb->createNamedParameter($favoriteIds, IQueryBuilder::PARAM_INT_ARRAY)));
		}
		if ($tagId !== null && $tagId > 0) {
			try {
				$mapped = $this->systemTagObjectMapper->getObjectIdsForTags([$tagId], 'files');
			} catch (TagNotFoundException) {
				return ['items' => [], 'total' => 0, 'page' => $page, 'limit' => $limit];
			}
			$tagFileIds = array_values(array_filter(
				array_map('intval', $mapped),
				fn (int $id): bool => $this->fileAccess->isFileAccessible($userId, $id),
			));
			if ($tagFileIds === []) {
				return ['items' => [], 'total' => 0, 'page' => $page, 'limit' => $limit];
			}
			$qb->andWhere($qb->expr()->in('t.file_id', $qb->createNamedParameter($tagFileIds, IQueryBuilder::PARAM_INT_ARRAY)));
		}
		if ($hideListened) {
			$qb->leftJoin('t', 'ac_play_state', 'ps_hl', $qb->expr()->andX(
				$qb->expr()->eq('ps_hl.user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('ps_hl.file_id', 't.file_id'),
			));
			$qb->andWhere($qb->expr()->orX(
				$qb->expr()->isNull('ps_hl.file_id'),
				$qb->expr()->eq('ps_hl.listened', $qb->createNamedParameter(0, \PDO::PARAM_INT)),
			));
		}

		if ($sort === self::SORT_PLAYED) {
			$qb->leftJoin('t', 'ac_play_state', 'ps', $qb->expr()->andX(
				$qb->expr()->eq('ps.user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('ps.file_id', 't.file_id'),
			));
		}

		$countQb = clone $qb;
		$countQb->select($countQb->func()->count('t.id', 'c'));
		$countResult = $countQb->executeQuery();
		$total = (int)($countResult->fetch()['c'] ?? 0);
		$countResult->closeCursor();

		// Sort only the page query: an ORDER BY on a non-aggregated column in
		// the COUNT query is rejected by PostgreSQL and by MySQL 8 with
		// ONLY_FULL_GROUP_BY (default), even though MariaDB tolerates it.
		$this->applyTrackSort($qb, $sort);
		$qb->select('t.file_id', 't.file_name', 't.rel_path', 't.added_at', 't.size', 'm.title', 'm.artist', 'm.album', 'm.album_artist', 'm.duration_ms', 'm.mimetype', 'm.has_chapters', 'm.cover_state')
			->selectAlias($qb->createFunction($this->effectiveKindSql()), 'kind');
		$qb->setMaxResults($limit)->setFirstResult($offset);
		$result = $qb->executeQuery();
		$items = [];
		while ($row = $result->fetch()) {
			$items[] = $this->formatTrackForUser($userId, $row);
		}
		$result->closeCursor();
		$this->applyListenedFlags($userId, $items);
		$this->applyFavoriteFlags($items);

		return ['items' => $items, 'total' => $total, 'page' => $page, 'limit' => $limit];
	}

	public function getTrackInfo(string $userId, int $fileId): array
	{
		$this->fileAccess->resolveReadableFile($userId, $fileId);
		$row = $this->findTrackRow($userId, $fileId);
		if ($row === null) {
			throw new NotFoundException();
		}
		return $this->formatTrackRow($row, $fileId, $userId);
	}

	/**
	 * Resolve a playable track for deep-links (indexed or not yet scanned).
	 *
	 * @return array<string, mixed>
	 */
	public function getPlayableTrack(string $userId, int $fileId): array
	{
		$file = $this->fileAccess->resolveReadableFile($userId, $fileId);
		$row = $this->findTrackRow($userId, $fileId);
		if ($row !== null) {
			return $this->formatTrackRow($row, $fileId, $userId);
		}
		return $this->minimalTrackFromFile($file);
	}

	/**
	 * @return array{items:list<array<string,mixed>>,folderName:string,folderId:int}
	 */
	public function listFolderTracks(string $userId, int $folderId): array
	{
		$folder = $this->fileAccess->resolveReadableFolder($userId, $folderId);
		$files = $this->fileAccess->listAudioFilesInFolder($folder, false);
		$items = [];
		foreach ($files as $file) {
			$row = $this->findTrackRow($userId, (int)$file->getId());
			$items[] = $row !== null
				? $this->formatTrackRow($row, (int)$file->getId(), $userId)
				: $this->minimalTrackFromFile($file);
		}
		return [
			'items' => $items,
			'folderName' => $folder->getName(),
			'folderId' => $folderId,
		];
	}

	/** @return array{favorite:bool} */
	public function setFavorite(string $userId, int $fileId, bool $favorite): array
	{
		$this->fileAccess->resolveReadableFile($userId, $fileId);
		$tagger = $this->tagManager->load('files');
		if ($tagger === null) {
			throw new ValidationException('Favorites are not available.');
		}
		// Idempotent PUT: repeating the current state must not re-insert the
		// favorite relation (core Tags::tagAs would log a PK violation).
		if ($favorite !== $this->isFavorite($fileId)) {
			$ok = $favorite
				? $tagger->addToFavorites($fileId)
				: $tagger->removeFromFavorites($fileId);
			// A concurrent request may have won the same transition; only fail
			// when the store genuinely does not reflect the desired state.
			if ($ok === false && $this->isFavorite($fileId) !== $favorite) {
				throw new ValidationException('Could not update favorite state.');
			}
		}
		return ['favorite' => $favorite];
	}

	public function isFavorite(int $fileId): bool
	{
		$tagger = $this->tagManager->load('files');
		if ($tagger === null) {
			return false;
		}
		$tags = $tagger->getTagsForObjects([$fileId]);
		if ($tags === false || $tags === []) {
			return false;
		}
		$fileTags = current($tags);
		if (!is_array($fileTags)) {
			return false;
		}
		return in_array(ITags::TAG_FAVORITE, $fileTags, true);
	}

	/**
	 * @return array{items:list<array<string,mixed>>,total:int,page:int,limit:int}
	 */
	public function listCollections(string $userId, ?string $kind, ?string $q, string $sort, int $page, int $limit): array
	{
		$page = max(1, $page);
		$limit = min(100, max(1, $limit));
		$offset = ($page - 1) * $limit;

		$albumExpr = $this->effectiveAlbumSql();
		$albumArtistExpr = $this->effectiveAlbumArtistSql();

		$qb = $this->db->getQueryBuilder();
		$kindExpr = $this->effectiveKindSql();
		$qb->selectAlias($qb->createFunction($albumExpr), 'album')
			->selectAlias($qb->createFunction($albumArtistExpr), 'album_artist')
			->selectAlias($qb->func()->min('m.artist'), 'artist')
			->selectAlias($qb->createFunction($kindExpr), 'kind')
			->selectAlias($qb->func()->count('t.id'), 'track_count')
			->selectAlias($qb->func()->min('t.file_id'), 'cover_file_id')
			->selectAlias($qb->func()->max('t.added_at'), 'added_at')
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->joinLibraryForEffectiveKind($qb);
		$qb->leftJoin('t', 'ac_play_state', 'ps', $qb->expr()->andX(
				$qb->expr()->eq('ps.user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('ps.file_id', 't.file_id'),
			))
			->selectAlias($qb->func()->max('ps.updated_at'), 'last_played_at')
			->selectAlias(
				$qb->createFunction('SUM(CASE WHEN COALESCE(ps.listened, 0) = 1 THEN 1 ELSE 0 END)'),
				'listened_count',
			)
			->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->groupBy($qb->createFunction($albumExpr))
			->addGroupBy($qb->createFunction($albumArtistExpr))
			->addGroupBy($qb->createFunction($kindExpr));
		$this->applyEffectiveKindFilter($qb, $kind);
		$this->applySearchFilter($qb, [
			$qb->createFunction($this->effectiveAlbumNormSql()),
			'm.artist_norm',
			$qb->createFunction($this->effectiveAlbumArtistNormSql()),
		], $q);

		$sortCol = match ($sort) {
			self::SORT_ARTIST => 'album_artist',
			self::SORT_ADDED => 'added_at',
			self::SORT_PLAYED => 'last_played_at',
			default => 'album',
		};
		$qb->orderBy($sortCol, ($sort === self::SORT_ADDED || $sort === self::SORT_PLAYED) ? 'DESC' : 'ASC');

		$total = $this->countCollectionGroups($userId, $kind, $q);

		$qb->setMaxResults($limit)->setFirstResult($offset);
		$result = $qb->executeQuery();
		$items = [];
		while ($row = $result->fetch()) {
			$key = $this->collectionKey((string)$row['album'], (string)($row['album_artist'] ?? ''), (string)$row['kind']);
			$trackCount = (int)$row['track_count'];
			$listenedCount = (int)($row['listened_count'] ?? 0);
			$items[] = [
				'key' => $key,
				'title' => (string)$row['album'],
				'subtitle' => (string)($row['album_artist'] ?: $row['artist'] ?? ''),
				'kind' => (string)$row['kind'],
				'trackCount' => $trackCount,
				'listenedCount' => $listenedCount,
				'fullyListened' => $trackCount > 0 && $listenedCount >= $trackCount,
				'coverFileId' => (int)$row['cover_file_id'],
				'addedAt' => (int)$row['added_at'],
			];
		}
		$result->closeCursor();

		return ['items' => $items, 'total' => $total, 'page' => $page, 'limit' => $limit];
	}

	/**
	 * @return array<string, mixed>
	 */
	public function getCollection(string $userId, string $key, int $page = 1, int $limit = 0): array
	{
		$decoded = $this->decodeCollectionKey($key);
		$page = max(1, $page);
		if ($limit < 0) {
			$limit = 0;
		} elseif ($limit > 0) {
			$limit = min(100, $limit);
		}

		$total = $this->countCollectionTracks($userId, $decoded);
		if ($total === 0) {
			throw new NotFoundException();
		}

		$listenedCount = $this->queryCollectionListenedCount($userId, $decoded);
		$tracks = $this->queryCollectionTracks($userId, $decoded, $page, $limit);
		$this->applyListenedFlags($userId, $tracks);

		$collection = [
			'key' => $key,
			'title' => $decoded['album'],
			'subtitle' => $decoded['albumArtist'],
			'kind' => $decoded['kind'],
			'tracks' => $tracks,
			'trackCount' => $total,
			'listenedCount' => $listenedCount,
			'fullyListened' => $total > 0 && $listenedCount >= $total,
		];
		if ($limit > 0) {
			$collection['page'] = $page;
			$collection['limit'] = $limit;
		}

		return $collection;
	}

	/**
	 * @param array{album:string,albumArtist:string,kind:string} $decoded
	 */
	private function countCollectionTracks(string $userId, array $decoded): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->selectAlias($qb->func()->count('t.id'), 'c')
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->applyCollectionTrackFilters($qb, $userId, $decoded);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();

		return (int)($row['c'] ?? 0);
	}

	/**
	 * @param array{album:string,albumArtist:string,kind:string} $decoded
	 */
	private function queryCollectionListenedCount(string $userId, array $decoded): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->selectAlias(
			$qb->createFunction('SUM(CASE WHEN COALESCE(ps.listened, 0) = 1 THEN 1 ELSE 0 END)'),
			'listened_count',
		)
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
			->leftJoin('t', 'ac_play_state', 'ps', $qb->expr()->andX(
				$qb->expr()->eq('ps.user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('ps.file_id', 't.file_id'),
			));
		$this->applyCollectionTrackFilters($qb, $userId, $decoded);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();

		return (int)($row['listened_count'] ?? 0);
	}

	/**
	 * @param array{album:string,albumArtist:string,kind:string} $decoded
	 * @return list<array<string,mixed>>
	 */
	private function queryCollectionTracks(string $userId, array $decoded, int $page, int $limit): array
	{
		$albumExpr = $this->effectiveAlbumSql();
		$albumArtistExpr = $this->effectiveAlbumArtistSql();
		$qb = $this->db->getQueryBuilder();
		$qb->select('t.file_id', 't.file_name', 't.added_at', 'm.title', 'm.artist', 'm.album', 'm.album_artist', 'm.duration_ms', 'm.mimetype', 'm.track_no', 'm.disc_no', 'm.has_chapters', 'm.cover_state')
			->selectAlias($qb->createFunction($this->effectiveKindSql()), 'kind')
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->applyCollectionTrackFilters($qb, $userId, $decoded);
		$qb->orderBy('m.disc_no', 'ASC')->addOrderBy('m.track_no', 'ASC')->addOrderBy('t.file_name', 'ASC');
		if ($limit > 0) {
			$offset = ($page - 1) * $limit;
			$qb->setMaxResults($limit)->setFirstResult($offset);
		}
		$result = $qb->executeQuery();
		$tracks = [];
		while ($row = $result->fetch()) {
			$tracks[] = $this->formatTrackForUser($userId, $row);
		}
		$result->closeCursor();

		return $tracks;
	}

	/**
	 * @param array{album:string,albumArtist:string,kind:string} $decoded
	 */
	private function applyCollectionTrackFilters(\OCP\DB\QueryBuilder\IQueryBuilder $qb, string $userId, array $decoded): void
	{
		$albumExpr = $this->effectiveAlbumSql();
		$albumArtistExpr = $this->effectiveAlbumArtistSql();
		$this->joinLibraryForEffectiveKind($qb);
		$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq($qb->createFunction($albumExpr), $qb->createNamedParameter($decoded['album'])))
			->andWhere($qb->expr()->eq($qb->createFunction($this->effectiveKindSql()), $qb->createNamedParameter($decoded['kind'])));
		if ($decoded['albumArtist'] !== '') {
			$qb->andWhere($qb->expr()->eq($qb->createFunction($albumArtistExpr), $qb->createNamedParameter($decoded['albumArtist'])));
		} else {
			$qb->andWhere($qb->expr()->eq($qb->createFunction($albumArtistExpr), $qb->createNamedParameter('')));
		}
	}

	/** @return list<int> */
	private function listCollectionFileIds(string $userId, string $key): array
	{
		$decoded = $this->decodeCollectionKey($key);
		$qb = $this->db->getQueryBuilder();
		$qb->select('t.file_id')
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->applyCollectionTrackFilters($qb, $userId, $decoded);
		$result = $qb->executeQuery();
		$fileIds = [];
		while ($row = $result->fetch()) {
			$fileIds[] = (int)$row['file_id'];
		}
		$result->closeCursor();

		return $fileIds;
	}

	/**
	 * Mark every accessible track in a collection listened/unlistened (plan §3.5 collection-level).
	 *
	 * @return array{collection:array<string,mixed>,updatedCount:int,skippedCount:int}
	 */
	public function setCollectionListened(string $userId, string $key, bool $listened): array
	{
		$fileIds = $this->listCollectionFileIds($userId, $key);
		if ($fileIds === []) {
			throw new NotFoundException();
		}
		$result = $this->setListenedForFileIds($userId, $fileIds, $listened);
		$refreshed = $this->getCollection($userId, $key, 1, 0);

		return [
			'collection' => $refreshed,
			'updatedCount' => $result['updated'],
			'skippedCount' => $result['skipped'],
		];
	}

	/**
	 * @param list<int> $fileIds
	 * @return array{updated:int,skipped:int}
	 */
	public function setListenedBulk(string $userId, array $fileIds, bool $listened): array
	{
		$fileIds = array_values(array_unique(array_filter(
			array_map(static fn (mixed $id): int => (int)$id, $fileIds),
			static fn (int $id): bool => $id > 0,
		)));
		if (count($fileIds) > PlaybackStateService::MAX_BULK_LISTENED_REQUEST) {
			throw new ValidationException('Too many tracks in one request.');
		}

		return $this->setListenedForFileIds($userId, $fileIds, $listened);
	}

	/**
	 * @return array{folderPath:string,trackCount:int,listenedCount:int,fullyListened:bool}
	 */
	public function getFolderPathListenedStats(string $userId, string $folderPath, ?string $kind): array
	{
		$fileIds = $this->listTrackFileIdsByFolderPath($userId, $folderPath, $kind);

		return $this->buildListenedStats($folderPath, $fileIds, $userId);
	}

	/**
	 * Mark every indexed track under a library folder path listened/unlistened.
	 *
	 * @return array{folderPath:string,trackCount:int,listenedCount:int,fullyListened:bool,updatedCount:int,skippedCount:int}
	 */
	public function setFolderPathListened(string $userId, string $folderPath, ?string $kind, bool $listened): array
	{
		$normalized = $this->normalizeFolderPath($folderPath);
		$fileIds = $this->listTrackFileIdsByFolderPath($userId, $normalized, $kind);
		$result = $this->setListenedForFileIds($userId, $fileIds, $listened);
		$stats = $this->buildListenedStats($normalized, $fileIds, $userId);

		return array_merge($stats, [
			'updatedCount' => $result['updated'],
			'skippedCount' => $result['skipped'],
		]);
	}

	/**
	 * Mark every audio file in a Nextcloud folder listened/unlistened (non-recursive).
	 *
	 * @return array{folderId:int,folderName:string,trackCount:int,listenedCount:int,fullyListened:bool,updatedCount:int,skippedCount:int}
	 */
	public function setFolderIdListened(string $userId, int $folderId, bool $listened): array
	{
		$folder = $this->fileAccess->resolveReadableFolder($userId, $folderId);
		$files = $this->fileAccess->listAudioFilesInFolder($folder, false);
		$fileIds = array_values(array_unique(array_map(static fn ($file): int => (int)$file->getId(), $files)));
		$result = $this->setListenedForFileIds($userId, $fileIds, $listened);
		$map = $this->playback->getListenedMap($userId, $fileIds);
		$listenedCount = count(array_filter($map));
		$trackCount = count($fileIds);

		return [
			'folderId' => $folderId,
			'folderName' => $folder->getName(),
			'trackCount' => $trackCount,
			'listenedCount' => $listenedCount,
			'fullyListened' => $trackCount > 0 && $listenedCount >= $trackCount,
			'updatedCount' => $result['updated'],
			'skippedCount' => $result['skipped'],
		];
	}

	/**
	 * @param list<int> $fileIds
	 * @return array{updated:int,skipped:int}
	 */
	private function setListenedForFileIds(string $userId, array $fileIds, bool $listened): array
	{
		if ($fileIds === []) {
			return ['updated' => 0, 'skipped' => 0];
		}
		$updated = 0;
		$skipped = 0;
		foreach (array_chunk($fileIds, PlaybackStateService::MAX_BULK_LISTENED) as $chunk) {
			$result = $this->playback->setListenedBulk($userId, $chunk, $listened);
			$updated += $result['updated'];
			$skipped += $result['skipped'];
		}

		return ['updated' => $updated, 'skipped' => $skipped];
	}

	/**
	 * @return list<int>
	 */
	private function listTrackFileIdsByFolderPath(string $userId, string $folderPath, ?string $kind): array
	{
		$folderPath = $this->normalizeFolderPath($folderPath);
		$like = $this->db->escapeLikeParameter($folderPath) . '/%';
		$qb = $this->db->getQueryBuilder();
		$qb->select('t.file_id')
			->from('ac_tracks', 't')
			->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->joinLibraryForEffectiveKind($qb);
		$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->like('t.rel_path', $qb->createNamedParameter($like)));
		$this->applyEffectiveKindFilter($qb, $kind);
		$result = $qb->executeQuery();
		$fileIds = [];
		while ($row = $result->fetch()) {
			$fileIds[] = (int)$row['file_id'];
		}
		$result->closeCursor();

		return array_values(array_unique($fileIds));
	}

	private function normalizeFolderPath(string $folderPath): string
	{
		$folderPath = rtrim(trim($folderPath), '/');
		if ($folderPath === '') {
			throw new ValidationException('Folder path is required.');
		}

		return $folderPath;
	}

	/**
	 * @param list<int> $fileIds
	 * @return array{folderPath:string,trackCount:int,listenedCount:int,fullyListened:bool}
	 */
	private function buildListenedStats(string $folderPath, array $fileIds, string $userId): array
	{
		$map = $this->playback->getListenedMap($userId, $fileIds);
		$listenedCount = count(array_filter($map));
		$trackCount = count($fileIds);

		return [
			'folderPath' => $folderPath,
			'trackCount' => $trackCount,
			'listenedCount' => $listenedCount,
			'fullyListened' => $trackCount > 0 && $listenedCount >= $trackCount,
		];
	}

	/** @param array<string, mixed> $collection */
	private function enrichCollectionListenedStats(array $collection): array
	{
		$tracks = $collection['tracks'] ?? [];
		if (!is_array($tracks)) {
			$tracks = [];
		}
		$trackCount = count($tracks);
		$listenedCount = 0;
		foreach ($tracks as $track) {
			if (!is_array($track)) {
				continue;
			}
			if (!empty($track['listened'])) {
				$listenedCount++;
			}
		}
		$collection['trackCount'] = $trackCount;
		$collection['listenedCount'] = $listenedCount;
		$collection['fullyListened'] = $trackCount > 0 && $listenedCount >= $trackCount;

		return $collection;
	}

	/**
	 * @return array{items:list<array<string,mixed>>,total:int,page?:int,limit?:int}
	 */
	public function listFacets(string $userId, string $type, ?string $q, ?string $kind = null, int $page = 1, int $limit = 0): array
	{
		$page = max(1, $page);
		if ($limit < 0) {
			$limit = 0;
		} elseif ($limit > 0) {
			$limit = min(100, $limit);
		}

		if ($type === 'favorites') {
			return $this->paginateFacetItems($this->listFavoriteFacet($userId), $page, $limit);
		}
		if ($type === 'tags') {
			return $this->paginateFacetItems($this->listTagFacets($userId, $q), $page, $limit);
		}

		$displayColumn = match ($type) {
			'artists' => 'm.artist',
			'authors' => 'm.artist',
			'series' => 'm.series',
			'genres' => 'm.genre',
			'folders' => 't.rel_path',
			default => throw new ValidationException('Invalid facet type.'),
		};
		$searchColumn = match ($type) {
			'artists', 'authors' => 'm.artist_norm',
			'series' => 'm.series_norm',
			'genres' => 'm.genre_norm',
			'folders' => 't.rel_path',
			default => throw new ValidationException('Invalid facet type.'),
		};

		$qb = $this->db->getQueryBuilder();
		if ($type === 'folders') {
			$qb->select('t.rel_path')
				->selectAlias($qb->func()->count('t.id'), 'c')
				->from('ac_tracks', 't')
				->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
			$this->joinLibraryForEffectiveKind($qb);
			$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)));
			$this->applyEffectiveKindFilter($qb, $kind);
			$qb->groupBy('t.rel_path');
		} else {
			$qb->selectAlias($displayColumn, 'name')
				->selectAlias($qb->func()->count('t.id'), 'c')
				->from('ac_tracks', 't')
				->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
			$this->joinLibraryForEffectiveKind($qb);
			$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->isNotNull($displayColumn))
				->groupBy($displayColumn);
			if ($type === 'artists') {
				$this->applyEffectiveKindFilter($qb, self::KIND_MUSIC);
			} elseif ($type === 'authors') {
				$this->applyEffectiveKindFilter($qb, self::KIND_AUDIOBOOK);
			} elseif ($type === 'series') {
				$qb->andWhere($qb->expr()->neq($displayColumn, $qb->createNamedParameter('')));
			}
		}

		if ($type !== 'folders') {
			$this->applySearchFilter($qb, [$searchColumn], $q);
		}

		$result = $qb->executeQuery();
		$items = [];
		while ($row = $result->fetch()) {
			if ($type === 'folders') {
				$path = (string)$row['rel_path'];
				$count = (int)$row['c'];
				$folder = dirname($path);
				if ($folder === '.' || $folder === '') {
					continue;
				}
				// Count tracks recursively per folder prefix so counts match listTracks(folder=…).
				$current = $folder;
				while ($current !== '.' && $current !== '' && $current !== 'files') {
					$items[$current] = ($items[$current] ?? 0) + $count;
					$parent = dirname($current);
					if ($parent === $current) {
						break;
					}
					$current = $parent;
				}
			} else {
				$name = (string)$row['name'];
				if ($name !== '') {
					$items[] = ['name' => $name, 'count' => (int)$row['c']];
				}
			}
		}
		$result->closeCursor();

		if ($type === 'folders') {
			$folderItems = [];
			foreach ($items as $name => $count) {
				$folderItems[] = ['name' => $name, 'count' => $count];
			}
			usort($folderItems, static fn ($a, $b) => strcmp($a['name'], $b['name']));
			$folderItems = $this->filterFolderFacetItems($folderItems, $q);
			return $this->paginateFacetItems(['items' => $folderItems, 'total' => count($folderItems)], $page, $limit);
		}

		usort($items, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));
		return $this->paginateFacetItems(['items' => $items, 'total' => count($items)], $page, $limit);
	}

	/**
	 * @param array{items:list<array<string,mixed>>,total:int} $payload
	 * @return array{items:list<array<string,mixed>>,total:int,page?:int,limit?:int}
	 */
	private function paginateFacetItems(array $payload, int $page, int $limit): array
	{
		$items = $payload['items'];
		$total = (int)($payload['total'] ?? count($items));
		if ($limit <= 0) {
			return ['items' => $items, 'total' => $total];
		}
		$offset = ($page - 1) * $limit;

		return [
			'items' => array_slice($items, $offset, $limit),
			'total' => $total,
			'page' => $page,
			'limit' => $limit,
		];
	}

	public function collectionKey(string $album, string $albumArtist, string $kind): string
	{
		return rtrim(strtr(base64_encode($album . "\0" . $albumArtist . "\0" . $kind), '+/', '-_'), '=');
	}

	/**
	 * Maximum number of search tokens honoured per query. Guards against
	 * pathological inputs (hundreds of words) inflating the generated SQL.
	 */
	private const SEARCH_MAX_TOKENS = 8;

	/**
	 * Split a raw search string into normalized, de-duplicated tokens.
	 *
	 * Mirrors the mobile client's tokenizer: whitespace separated and order
	 * independent. Tokens are matched with AND semantics by the caller, so
	 * "beatles abbey" finds a track whose artist is "The Beatles" and whose
	 * album is "Abbey Road".
	 *
	 * @return list<string>
	 */
	private function searchTokens(?string $q): array
	{
		return SearchTextNormalizer::tokenize($q, self::SEARCH_MAX_TOKENS);
	}

	/**
	 * Apply a forgiving search filter to a query builder.
	 *
	 * Every token must match (AND); within a token any of the supplied fields
	 * may match (OR). Query tokens and field values are normalized the same way
	 * as the mobile offline matcher (see SearchTextNormalizer). Search targets
	 * the *_norm shadow columns populated on scan/metadata write.
	 *
	 * @param list<string|IQueryFunction> $fields Column names or SQL expressions to search.
	 */
	private function applySearchFilter(IQueryBuilder $qb, array $fields, ?string $q): void
	{
		if ($fields === []) {
			return;
		}
		foreach ($this->searchTokens($q) as $token) {
			$like = '%' . $this->db->escapeLikeParameter($token) . '%';
			$param = $qb->createNamedParameter($like);
			$conditions = [];
			foreach ($fields as $field) {
				$conditions[] = $qb->expr()->like($field, $param);
			}
			$qb->andWhere($qb->expr()->orX(...$conditions));
		}
	}

	private function effectiveAlbumSql(): string
	{
		return "COALESCE(NULLIF(m.album, ''), NULLIF(m.title, ''), t.file_name)";
	}

	private function effectiveAlbumArtistSql(): string
	{
		return "COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), '')";
	}

	private function effectiveAlbumNormSql(): string
	{
		return "COALESCE(NULLIF(m.album_norm, ''), NULLIF(m.title_norm, ''), t.file_name_norm)";
	}

	private function effectiveAlbumArtistNormSql(): string
	{
		return "COALESCE(NULLIF(m.album_artist_norm, ''), NULLIF(m.artist_norm, ''), '')";
	}

	private function effectiveKindSql(): string
	{
		return "CASE WHEN lib.content_kind IN ('music','audiobook') THEN lib.content_kind ELSE COALESCE(m.kind, 'music') END";
	}

	private function joinLibraryForEffectiveKind(IQueryBuilder $qb, string $trackAlias = 't'): void
	{
		$qb->leftJoin($trackAlias, 'ac_libraries', 'lib', $qb->expr()->andX(
			$qb->expr()->eq('lib.id', $trackAlias . '.library_id'),
			$qb->expr()->eq('lib.user_id', $trackAlias . '.user_id'),
		));
	}

	private function applyEffectiveKindFilter(IQueryBuilder $qb, ?string $kind): void
	{
		if ($kind === null || !in_array($kind, [self::KIND_MUSIC, self::KIND_AUDIOBOOK], true)) {
			return;
		}
		$qb->andWhere($qb->expr()->eq(
			$qb->createFunction($this->effectiveKindSql()),
			$qb->createNamedParameter($kind),
		));
	}

	/**
	 * @param list<array{name:string,count:int}> $folderItems
	 * @return list<array{name:string,count:int}>
	 */
	private function filterFolderFacetItems(array $folderItems, ?string $q): array
	{
		$tokens = $this->searchTokens($q);
		if ($tokens === []) {
			return $folderItems;
		}

		return array_values(array_filter($folderItems, static function (array $item) use ($tokens): bool {
			$name = (string)($item['name'] ?? '');
			$label = basename(str_replace('\\', '/', $name));
			$haystack = SearchTextNormalizer::normalize($name . ' ' . $label);
			if ($haystack === null) {
				return false;
			}
			foreach ($tokens as $token) {
				if (!str_contains($haystack, $token)) {
					return false;
				}
			}
			return true;
		}));
	}

	/** @return array{album:string,albumArtist:string,kind:string} */
	public function decodeCollectionKey(string $key): array
	{
		$pad = strlen($key) % 4;
		if ($pad > 0) {
			$key .= str_repeat('=', 4 - $pad);
		}
		$decoded = base64_decode(strtr($key, '-_', '+/'), true);
		if ($decoded === false) {
			throw new NotFoundException();
		}
		$parts = explode("\0", $decoded, 3);
		if (count($parts) < 3) {
			throw new NotFoundException();
		}
		return ['album' => $parts[0], 'albumArtist' => $parts[1], 'kind' => $parts[2]];
	}

	/** @param array<string, mixed> $row */
	private function formatLibrary(array $row): array
	{
		$userId = (string)$row['user_id'];
		$libraryId = (int)$row['id'];
		return [
			'id' => $libraryId,
			'folderPath' => (string)$row['folder_path'],
			'rootFileId' => $row['root_file_id'] !== null ? (int)$row['root_file_id'] : null,
			'includeSubfolders' => (int)$row['include_subfolders'] === 1,
			'contentKind' => $this->normalizeContentKind((string)($row['content_kind'] ?? self::CONTENT_KIND_AUTO)),
			'enabled' => (int)$row['enabled'] === 1,
			'createdAt' => (int)$row['created_at'],
			'trackCount' => $this->countTracksForLibrary($userId, $libraryId),
		];
	}

	private function countTracksForLibrary(string $userId, int $libraryId): int
	{
		if ($libraryId < 1) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('id', 'c'))
			->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('library_id', $qb->createNamedParameter($libraryId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$count = (int)($result->fetch()['c'] ?? 0);
		$result->closeCursor();
		return $count;
	}

	/** @param array<string, mixed> $row */
	private function formatTrack(array $row): array
	{
		return [
			'fileId' => (int)$row['file_id'],
			'fileName' => (string)($row['file_name'] ?? ''),
			'title' => (string)($row['title'] ?? $row['file_name'] ?? ''),
			'artist' => (string)($row['artist'] ?? ''),
			'album' => (string)($row['album'] ?? ''),
			'albumArtist' => (string)($row['album_artist'] ?? ''),
			'kind' => (string)($row['kind'] ?? 'music'),
			'durationMs' => (int)($row['duration_ms'] ?? 0),
			'sizeBytes' => max(0, (int)($row['size'] ?? 0)),
			'mimetype' => (string)($row['mimetype'] ?? ''),
			'browserPlayable' => $this->isBrowserPlayableMime((string)($row['mimetype'] ?? '')),
			'hasChapters' => (int)($row['has_chapters'] ?? 0) === 1,
			'coverState' => (string)($row['cover_state'] ?? 'none'),
			'addedAt' => (int)($row['added_at'] ?? 0),
			'relPath' => (string)($row['rel_path'] ?? ''),
		];
	}

	/** @param array<string, mixed> $row */
	private function formatTrackForUser(string $userId, array $row): array
	{
		$track = $this->formatTrack($row);
		$track['unavailable'] = !$this->fileAccess->isFileAccessible($userId, (int)$row['file_id']);
		return $this->redactUnavailableMetadata($track);
	}

	/** @param array<string, mixed> $track */
	private function redactUnavailableMetadata(array $track): array
	{
		if (!($track['unavailable'] ?? false)) {
			return $track;
		}
		$track['title'] = '';
		$track['artist'] = '';
		$track['album'] = '';
		$track['fileName'] = '';
		return $track;
	}

	private function countCollectionGroups(string $userId, ?string $kind, ?string $q): int
	{
		$albumExpr = $this->effectiveAlbumSql();
		$albumArtistExpr = $this->effectiveAlbumArtistSql();
		$kindExpr = $this->effectiveKindSql();

		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->createFunction($albumExpr))
			->addSelect($qb->createFunction($albumArtistExpr))
			->addSelect($qb->createFunction($kindExpr))
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->joinLibraryForEffectiveKind($qb);
		$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->groupBy($qb->createFunction($albumExpr))
			->addGroupBy($qb->createFunction($albumArtistExpr))
			->addGroupBy($qb->createFunction($kindExpr));
		$this->applyEffectiveKindFilter($qb, $kind);
		$this->applySearchFilter($qb, [
			$qb->createFunction($this->effectiveAlbumNormSql()),
			'm.artist_norm',
			$qb->createFunction($this->effectiveAlbumArtistNormSql()),
		], $q);

		$result = $qb->executeQuery();
		$total = 0;
		while ($result->fetch()) {
			$total++;
		}
		$result->closeCursor();
		return $total;
	}

	private function isBrowserPlayableMime(string $mime): bool
	{
		$mime = trim($mime);
		if ($mime === '') {
			return true;
		}

		return $this->fileAccess->isLikelyBrowserPlayable($mime);
	}

	/** @return array<string, mixed>|null */
	private function findTrackRow(string $userId, int $fileId): ?array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('t.*', 'm.title', 'm.artist', 'm.album', 'm.album_artist', 'm.duration_ms', 'm.mimetype', 'm.has_chapters', 'm.chapters_json', 'm.cover_state', 'm.genre', 'm.track_no', 'm.disc_no', 'm.release_year')
			->selectAlias($qb->createFunction($this->effectiveKindSql()), 'kind')
			->from('ac_tracks', 't')
			->innerJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'));
		$this->joinLibraryForEffectiveKind($qb);
		$qb->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('t.file_id', $qb->createNamedParameter($fileId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return $row === false ? null : $row;
	}

	/** @param list<array<string, mixed>> $items */
	private function applyListenedFlags(string $userId, array &$items): void
	{
		$fileIds = array_map(static fn (array $item): int => (int)($item['fileId'] ?? 0), $items);
		$map = $this->playback->getListenedMap($userId, $fileIds);
		foreach ($items as &$item) {
			$fileId = (int)($item['fileId'] ?? 0);
			$item['listened'] = $map[$fileId] ?? false;
		}
		unset($item);
	}

	/** @param list<array<string, mixed>> $items */
	private function applyFavoriteFlags(array &$items): void
	{
		$favoriteSet = array_fill_keys($this->loadFavoriteFileIds(), true);
		foreach ($items as &$item) {
			$fileId = (int)($item['fileId'] ?? 0);
			$item['favorite'] = isset($favoriteSet[$fileId]);
		}
		unset($item);
	}

	/**
	 * Favorite file ids for the acting user, hardened against the ITags
	 * contract: getFavorites() is documented as array|false and may fail on
	 * transient DB errors. A broken favorites lookup must never take down
	 * track listing (it degrades to "no favorites" instead).
	 *
	 * @return list<int>
	 */
	private function loadFavoriteFileIds(): array
	{
		try {
			$tagger = $this->tagManager->load('files');
		} catch (\Throwable) {
			return [];
		}
		if ($tagger === null) {
			return [];
		}
		$favorites = $tagger->getFavorites();
		if (!is_array($favorites)) {
			return [];
		}
		$ids = [];
		foreach ($favorites as $raw) {
			$id = (int)$raw;
			if ($id > 0) {
				$ids[] = $id;
			}
		}
		return array_values(array_unique($ids));
	}

	/** @return array{revision:int,trackCount:int} */
	public function getLibrarySyncState(string $userId): array
	{
		$qb = $this->db->getQueryBuilder();
		// func()->max() takes no alias parameter (unlike count()), so alias
		// explicitly — otherwise the result column name is driver-defined and
		// the row lookup below silently falls back to 0.
		$qb->selectAlias($qb->func()->max('last_seen_at'), 'max_seen')
			->addSelect($qb->func()->count('id', 'track_count'))
			->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();

		return [
			'revision' => (int)($row['max_seen'] ?? 0),
			'trackCount' => (int)($row['track_count'] ?? 0),
		];
	}

	/**
	 * @param list<int> $fileIds
	 * @return array<int, bool>
	 */
	public function queryListenedMap(string $userId, array $fileIds): array
	{
		$clean = [];
		foreach ($fileIds as $fileId) {
			$fileId = (int)$fileId;
			if ($fileId < 1 || isset($clean[$fileId])) {
				continue;
			}
			try {
				$this->fileAccess->resolveReadableFile($userId, $fileId);
				$clean[$fileId] = true;
			} catch (\Throwable) {
				continue;
			}
			if (count($clean) >= 500) {
				break;
			}
		}
		if ($clean === []) {
			return [];
		}

		return $this->playback->getListenedMap($userId, array_map('intval', array_keys($clean)));
	}

	/** @param array<string, mixed> $row */
	private function formatTrackRow(array $row, int $fileId, string $userId): array
	{
		$track = $this->formatTrack($row);
		if (!empty($row['chapters_json'])) {
			try {
				$track['chapters'] = json_decode((string)$row['chapters_json'], true, 64, JSON_THROW_ON_ERROR);
			} catch (\JsonException) {
				$track['chapters'] = [];
			}
		}
		$track['favorite'] = $this->isFavorite($fileId);
		$track['listened'] = $this->playback->getListenedMap($userId, [$fileId])[$fileId] ?? false;
		$track['unavailable'] = false;
		return $track;
	}

	/** @return array<string, mixed> */
	private function minimalTrackFromFile(File $file): array
	{
		$name = $file->getName();
		$title = pathinfo($name, PATHINFO_FILENAME);
		return [
			'fileId' => (int)$file->getId(),
			'fileName' => $name,
			'title' => $title !== '' ? $title : $name,
			'artist' => '',
			'album' => '',
			'albumArtist' => '',
			'kind' => 'music',
			'durationMs' => 0,
			'mimetype' => $file->getMimeType(),
			'browserPlayable' => $this->fileAccess->isLikelyBrowserPlayable($file->getMimeType(), $file->getName()),
			'hasChapters' => false,
			'coverState' => 'none',
			'addedAt' => 0,
			'relPath' => '',
			'sizeBytes' => max(0, (int)$file->getSize()),
			'favorite' => $this->isFavorite((int)$file->getId()),
			'listened' => false,
			'unavailable' => false,
		];
	}

	/** @return array<string, mixed> */
	private function assertLibraryOwned(string $userId, int $libraryId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_libraries')
			->where($qb->expr()->eq('id', $qb->createNamedParameter($libraryId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false) {
			throw new NotFoundException();
		}
		return $row;
	}

	private function applyTrackSort(\OCP\DB\QueryBuilder\IQueryBuilder $qb, string $sort): void
	{
		match ($sort) {
			self::SORT_ARTIST => $qb->orderBy('m.artist', 'ASC')->addOrderBy('m.album', 'ASC'),
			self::SORT_ADDED => $qb->orderBy('t.added_at', 'DESC'),
			self::SORT_PLAYED => $qb->orderBy('ps.updated_at', 'DESC')->addOrderBy('m.title', 'ASC'),
			default => $qb->orderBy('m.title', 'ASC'),
		};
	}

	/** @return array{items:list<array{name:string,count:int}>,total:int} */
	private function listFavoriteFacet(string $userId): array
	{
		$favoriteIds = $this->loadFavoriteFileIds();
		if ($favoriteIds === []) {
			return ['items' => [], 'total' => 0];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('t.id', 'c'))
			->from('ac_tracks', 't')
			->where($qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->in('t.file_id', $qb->createNamedParameter($favoriteIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		$count = (int)($result->fetch()['c'] ?? 0);
		$result->closeCursor();
		if ($count === 0) {
			return ['items' => [], 'total' => 0];
		}
		return ['items' => [['name' => 'favorites', 'count' => $count]], 'total' => 1];
	}

	/** @return array{items:list<array{name:string,count:int,id:int}>,total:int} */
	private function listTagFacets(string $userId, ?string $q): array
	{
		$fileIds = $this->listUserTrackFileIds($userId);
		if ($fileIds === []) {
			return ['items' => [], 'total' => 0];
		}
		$tagCounts = [];
		foreach ($this->systemTagManager->getAllTags() as $tag) {
			$tagId = (int)$tag->getId();
			$tagName = $tag->getName();
			if ($q !== null && trim($q) !== '' && stripos($tagName, trim($q)) === false) {
				continue;
			}
			try {
				$mapped = $this->systemTagObjectMapper->getObjectIdsForTags([$tagId], 'files');
			} catch (TagNotFoundException) {
				continue;
			}
			$intersect = array_intersect($fileIds, array_map('intval', $mapped));
			$c = count($intersect);
			if ($c > 0) {
				$tagCounts[] = ['id' => $tagId, 'name' => $tagName, 'count' => $c];
			}
		}
		usort($tagCounts, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));
		return ['items' => $tagCounts, 'total' => count($tagCounts)];
	}

	/** @return list<int> */
	private function listUserTrackFileIds(string $userId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('file_id')->from('ac_tracks')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$ids = [];
		while ($row = $result->fetch()) {
			$ids[] = (int)$row['file_id'];
		}
		$result->closeCursor();
		return $ids;
	}
}
