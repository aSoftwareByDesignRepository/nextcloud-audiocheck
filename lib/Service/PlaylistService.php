<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\ValidationException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IDBConnection;

class PlaylistService
{
	public function __construct(
		private IDBConnection $db,
		private FileAccessService $fileAccess,
		private LibraryService $library,
		private PlaybackStateService $playback,
		private ITimeFactory $timeFactory,
	) {
	}

	/** @return list<array<string, mixed>> */
	public function listPlaylists(string $userId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_playlists')
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->orderBy('is_pinned', 'DESC')
			->addOrderBy('name', 'ASC');
		$result = $qb->executeQuery();
		$rows = [];
		while ($row = $result->fetch()) {
			$summary = $this->formatPlaylistSummary($row);
			$summary['trackCount'] = $this->countItems((int)$row['id']);
			$rows[] = $summary;
		}
		$result->closeCursor();
		return $rows;
	}

	public function createPlaylist(string $userId, string $name, bool $pinned = false): array
	{
		$name = trim($name);
		if ($name === '' || mb_strlen($name) > 255) {
			throw new ValidationException('Invalid playlist name.');
		}
		$now = $this->timeFactory->getTime();
		$qb = $this->db->getQueryBuilder();
		$qb->insert('ac_playlists')
			->values([
				'user_id' => $qb->createNamedParameter($userId),
				'name' => $qb->createNamedParameter($name),
				'kind' => $qb->createNamedParameter('manual'),
				'is_pinned' => $qb->createNamedParameter($pinned ? 1 : 0, \PDO::PARAM_INT),
				'default_speed' => $qb->createNamedParameter(100, \PDO::PARAM_INT),
				'created_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
				'updated_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
			]);
		try {
			$qb->executeStatement();
		} catch (\Exception $e) {
			throw new ValidationException('Playlist name already exists.');
		}
		$id = (int)$this->db->lastInsertId('ac_playlists');
		return $this->getPlaylist($userId, $id);
	}

	public function getPlaylist(string $userId, int $playlistId): array
	{
		$row = $this->assertPlaylistOwned($userId, $playlistId);
		$playlist = $this->formatPlaylistSummary($row);
		$playlist['items'] = $this->listItems($userId, $playlistId);
		return $playlist;
	}

	public function updatePlaylist(string $userId, int $playlistId, array $payload): array
	{
		$this->assertPlaylistOwned($userId, $playlistId);
		$now = $this->timeFactory->getTime();
		$qb = $this->db->getQueryBuilder();
		$qb->update('ac_playlists')->set('updated_at', $qb->createNamedParameter($now, \PDO::PARAM_INT));

		if (isset($payload['name'])) {
			$name = trim((string)$payload['name']);
			if ($name === '' || mb_strlen($name) > 255) {
				throw new ValidationException('Invalid playlist name.');
			}
			$qb->set('name', $qb->createNamedParameter($name));
		}
		if (isset($payload['isPinned'])) {
			$qb->set('is_pinned', $qb->createNamedParameter($payload['isPinned'] ? 1 : 0, \PDO::PARAM_INT));
		}
		if (isset($payload['defaultSpeed'])) {
			$qb->set('default_speed', $qb->createNamedParameter((int)$payload['defaultSpeed'], \PDO::PARAM_INT));
		}

		$qb->where($qb->expr()->eq('id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
		return $this->getPlaylist($userId, $playlistId);
	}

	public function deletePlaylist(string $userId, int $playlistId): void
	{
		$this->assertPlaylistOwned($userId, $playlistId);
		$dq = $this->db->getQueryBuilder();
		$dq->delete('ac_playlist_items')->where($dq->expr()->eq('playlist_id', $dq->createNamedParameter($playlistId, \PDO::PARAM_INT)));
		$dq->executeStatement();
		$qb = $this->db->getQueryBuilder();
		$qb->delete('ac_playlists')
			->where($qb->expr()->eq('id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$qb->executeStatement();
	}

	public function addItem(string $userId, int $playlistId, int $fileId): array
	{
		$this->assertPlaylistOwned($userId, $playlistId);
		$this->fileAccess->resolveReadableFile($userId, $fileId);

		$maxOrder = $this->maxSortOrder($playlistId);
		$now = $this->timeFactory->getTime();
		$qb = $this->db->getQueryBuilder();
		$qb->insert('ac_playlist_items')
			->values([
				'playlist_id' => $qb->createNamedParameter($playlistId, \PDO::PARAM_INT),
				'file_id' => $qb->createNamedParameter($fileId, \PDO::PARAM_INT),
				'sort_order' => $qb->createNamedParameter($maxOrder + 1, \PDO::PARAM_INT),
				'added_at' => $qb->createNamedParameter($now, \PDO::PARAM_INT),
			]);
		try {
			$qb->executeStatement();
		} catch (\Exception) {
			throw new ValidationException('Track already in playlist.');
		}

		$uq = $this->db->getQueryBuilder();
		$uq->update('ac_playlists')
			->set('updated_at', $uq->createNamedParameter($now, \PDO::PARAM_INT))
			->where($uq->expr()->eq('id', $uq->createNamedParameter($playlistId, \PDO::PARAM_INT)));
		$uq->executeStatement();

		return $this->getPlaylist($userId, $playlistId);
	}

	/** @param list<int> $itemIds */
	public function reorderItems(string $userId, int $playlistId, array $itemIds): array
	{
		$this->assertPlaylistOwned($userId, $playlistId);
		$existingIds = $this->listItemIdsForPlaylist($playlistId);
		$requested = array_values(array_filter(array_map('intval', $itemIds), static fn (int $id): bool => $id > 0));
		if (count($requested) !== count($existingIds)) {
			throw new ValidationException('Invalid item order.');
		}
		$existingSet = array_flip($existingIds);
		foreach ($requested as $itemId) {
			if (!isset($existingSet[$itemId])) {
				throw new ValidationException('Invalid item order.');
			}
		}
		$order = 0;
		foreach ($requested as $itemId) {
			$qb = $this->db->getQueryBuilder();
			$qb->update('ac_playlist_items')
				->set('sort_order', $qb->createNamedParameter($order, \PDO::PARAM_INT))
				->where($qb->expr()->eq('id', $qb->createNamedParameter($itemId, \PDO::PARAM_INT)))
				->andWhere($qb->expr()->eq('playlist_id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)));
			$qb->executeStatement();
			$order++;
		}
		return $this->getPlaylist($userId, $playlistId);
	}

	/** @return list<int> */
	private function listItemIdsForPlaylist(int $playlistId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from('ac_playlist_items')
			->where($qb->expr()->eq('playlist_id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)))
			->orderBy('sort_order', 'ASC');
		$result = $qb->executeQuery();
		$ids = [];
		while ($row = $result->fetch()) {
			$ids[] = (int)$row['id'];
		}
		$result->closeCursor();
		return $ids;
	}

	public function removeItem(string $userId, int $itemId): void
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('pi.playlist_id', 'p.user_id')
			->from('ac_playlist_items', 'pi')
			->innerJoin('pi', 'ac_playlists', 'p', $qb->expr()->eq('pi.playlist_id', 'p.id'))
			->where($qb->expr()->eq('pi.id', $qb->createNamedParameter($itemId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false || (string)$row['user_id'] !== $userId) {
			throw new NotFoundException();
		}
		$dq = $this->db->getQueryBuilder();
		$dq->delete('ac_playlist_items')->where($dq->expr()->eq('id', $dq->createNamedParameter($itemId, \PDO::PARAM_INT)));
		$dq->executeStatement();
	}

	public function buildFromCollection(string $userId, string $name, string $collectionKey): array
	{
		$collection = $this->library->getCollection($userId, $collectionKey);
		$playlist = $this->createPlaylist($userId, $name);
		foreach ($collection['tracks'] as $track) {
			try {
				$this->addItem($userId, (int)$playlist['id'], (int)$track['fileId']);
			} catch (\Throwable) {
				continue;
			}
		}
		return $this->getPlaylist($userId, (int)$playlist['id']);
	}

	/** @return list<array<string, mixed>> */
	private function listItems(string $userId, int $playlistId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('pi.id', 'pi.file_id', 'pi.sort_order', 'm.title', 'm.artist', 'm.album', 'm.duration_ms', 'm.mimetype', 'm.kind')
			->from('ac_playlist_items', 'pi')
			->leftJoin('pi', 'ac_tracks', 't', $qb->expr()->andX(
				$qb->expr()->eq('t.user_id', $qb->createNamedParameter($userId)),
				$qb->expr()->eq('t.file_id', 'pi.file_id'),
			))
			->leftJoin('t', 'ac_file_meta', 'm', $qb->expr()->eq('t.meta_id', 'm.id'))
			->where($qb->expr()->eq('pi.playlist_id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)))
			->orderBy('pi.sort_order', 'ASC');
		$result = $qb->executeQuery();
		$items = [];
		while ($row = $result->fetch()) {
			$fileId = (int)$row['file_id'];
			$accessible = $this->fileAccess->isFileAccessible($userId, $fileId);
			$mime = (string)($row['mimetype'] ?? '');
			$items[] = [
				'id' => (int)$row['id'],
				'fileId' => $fileId,
				'sortOrder' => (int)$row['sort_order'],
				'title' => $accessible ? (string)($row['title'] ?? '') : '',
				'artist' => $accessible ? (string)($row['artist'] ?? '') : '',
				'album' => $accessible ? (string)($row['album'] ?? '') : '',
				'durationMs' => (int)($row['duration_ms'] ?? 0),
				'mimetype' => $mime,
				'kind' => (string)($row['kind'] ?? 'music'),
				'browserPlayable' => $mime === '' || $this->fileAccess->isLikelyBrowserPlayable($mime),
				'unavailable' => !$accessible,
			];
		}
		$result->closeCursor();
		$map = $this->playback->getListenedMap($userId, array_map(static fn (array $item): int => (int)$item['fileId'], $items));
		foreach ($items as &$item) {
			$item['listened'] = $map[(int)$item['fileId']] ?? false;
		}
		unset($item);
		foreach ($items as &$item) {
			$item['favorite'] = $this->library->isFavorite((int)$item['fileId']);
		}
		unset($item);
		return $items;
	}

	private function countItems(int $playlistId): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->count('id', 'c'))->from('ac_playlist_items')
			->where($qb->expr()->eq('playlist_id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return (int)($row['c'] ?? 0);
	}

	private function maxSortOrder(int $playlistId): int
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->max('sort_order', 'm'))->from('ac_playlist_items')
			->where($qb->expr()->eq('playlist_id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		return (int)($row['m'] ?? 0);
	}

	/** @return array<string, mixed> */
	private function assertPlaylistOwned(string $userId, int $playlistId): array
	{
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('ac_playlists')
			->where($qb->expr()->eq('id', $qb->createNamedParameter($playlistId, \PDO::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)));
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false) {
			throw new NotFoundException();
		}
		return $row;
	}

	/** @param array<string, mixed> $row */
	private function formatPlaylistSummary(array $row): array
	{
		return [
			'id' => (int)$row['id'],
			'name' => (string)$row['name'],
			'kind' => (string)$row['kind'],
			'isPinned' => (int)$row['is_pinned'] === 1,
			'defaultSpeed' => (int)$row['default_speed'],
			'coverFileId' => $row['cover_file_id'] !== null ? (int)$row['cover_file_id'] : null,
			'createdAt' => (int)$row['created_at'],
			'updatedAt' => (int)$row['updated_at'],
		];
	}
}
