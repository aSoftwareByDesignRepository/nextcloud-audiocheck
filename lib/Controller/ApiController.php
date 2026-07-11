<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller;

use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\AudioCheckException;
use OCA\AudioCheck\Exception\InternalErrorException;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCA\AudioCheck\Exception\ValidationException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

class ApiController extends Controller
{
	public function __construct(
		string $appName,
		IRequest $request,
		private AccessControlService $access,
		private LibraryService $library,
		private ScanService $scan,
		private PlaybackStateService $playback,
		private PlayQueueService $queue,
		private PlaylistService $playlists,
		private UserPrefsService $prefs,
		private RateLimitService $rateLimit,
		private LoggerInterface $logger,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listTracks(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$params = $this->request->getParams();
			$tagId = isset($params['tagId']) ? (int)$params['tagId'] : null;
			return $this->library->listTracks(
				$userId,
				isset($params['kind']) ? (string)$params['kind'] : null,
				isset($params['q']) ? (string)$params['q'] : null,
				(string)($params['sort'] ?? LibraryService::SORT_TITLE),
				(int)($params['page'] ?? 1),
				(int)($params['limit'] ?? 50),
				isset($params['favorite']) && ($params['favorite'] === '1' || $params['favorite'] === 'true'),
				$tagId !== null && $tagId > 0 ? $tagId : null,
				isset($params['genre']) ? (string)$params['genre'] : null,
				isset($params['artist']) ? (string)$params['artist'] : null,
				isset($params['series']) ? (string)$params['series'] : null,
				isset($params['folder']) ? (string)$params['folder'] : null,
				isset($params['hideListened']) && ($params['hideListened'] === '1' || $params['hideListened'] === 'true'),
			);
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getTrackInfo(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			return ['track' => $this->library->getTrackInfo($userId, $fileId)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getPlayableTrack(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			return ['track' => $this->library->getPlayableTrack($userId, $fileId)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listFolderTracks(int $folderId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($folderId): array {
			return $this->library->listFolderTracks($userId, $folderId);
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listCollections(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$params = $this->request->getParams();
			return $this->library->listCollections(
				$userId,
				isset($params['kind']) ? (string)$params['kind'] : null,
				isset($params['q']) ? (string)$params['q'] : null,
				(string)($params['sort'] ?? LibraryService::SORT_TITLE),
				(int)($params['page'] ?? 1),
				(int)($params['limit'] ?? 50),
			);
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getCollection(string $key): JSONResponse
	{
		return $this->safe(function (string $userId) use ($key): array {
			$params = $this->request->getParams();

			return [
				'collection' => $this->library->getCollection(
					$userId,
					$key,
					(int)($params['page'] ?? 1),
					(int)($params['limit'] ?? 0),
				),
			];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listFacets(string $type): JSONResponse
	{
		return $this->safe(function (string $userId) use ($type): array {
			$params = $this->request->getParams();
			$q = $params['q'] ?? null;
			$kind = $params['kind'] ?? null;
			$kindFilter = is_string($kind) && in_array($kind, ['music', 'audiobook'], true) ? $kind : null;

			return $this->library->listFacets(
				$userId,
				$type,
				is_string($q) ? $q : null,
				$kindFilter,
				(int)($params['page'] ?? 1),
				(int)($params['limit'] ?? 0),
			);
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getProgress(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$fileId = $this->request->getParam('fileId');
			return ['progress' => $this->playback->getProgress($userId, $fileId !== null ? (int)$fileId : null)];
		});
	}

	#[NoAdminRequired]
	public function saveProgress(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			$body = $this->getJsonBody();
			return ['progress' => $this->playback->saveProgress(
				$userId,
				$fileId,
				(int)($body['positionMs'] ?? 0),
				(int)($body['playbackSpeed'] ?? 100),
				(bool)($body['finished'] ?? false),
				(int)($body['durationMs'] ?? 0),
				isset($body['clientUpdatedAt']) ? (int)$body['clientUpdatedAt'] : null,
			)];
		});
	}

	#[NoAdminRequired]
	public function saveProgressBeacon(int $fileId): JSONResponse
	{
		return $this->saveProgress($fileId);
	}

	#[NoAdminRequired]
	public function deleteProgress(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			$this->playback->deleteProgress($userId, $fileId);
			return [];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getQueue(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['queue' => $this->queue->getQueue($userId)]);
	}

	#[NoAdminRequired]
	public function saveQueue(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$fileIds = is_array($body['fileIds'] ?? null) ? array_values($body['fileIds']) : [];
			return ['result' => $this->queue->saveQueue(
				$userId,
				$fileIds,
				(int)($body['currentIndex'] ?? 0),
				(int)($body['playbackSpeed'] ?? 100),
				(bool)($body['shuffle'] ?? false),
				(string)($body['repeatMode'] ?? 'off'),
				isset($body['clientUpdatedAt']) ? (int)$body['clientUpdatedAt'] : null,
			)];
		});
	}

	#[NoAdminRequired]
	public function saveQueueBeacon(): JSONResponse
	{
		return $this->saveQueue();
	}

	#[NoAdminRequired]
	public function clearQueue(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->queue->clearQueue($userId);
			return [];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listPlaylists(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['playlists' => $this->playlists->listPlaylists($userId)]);
	}

	#[NoAdminRequired]
	public function createPlaylist(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			return ['playlist' => $this->playlists->createPlaylist($userId, (string)($body['name'] ?? ''), (bool)($body['isPinned'] ?? false))];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getPlaylist(int $id): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['playlist' => $this->playlists->getPlaylist($userId, $id)]);
	}

	#[NoAdminRequired]
	public function updatePlaylist(int $id): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['playlist' => $this->playlists->updatePlaylist($userId, $id, $this->getJsonBody())]);
	}

	#[NoAdminRequired]
	public function deletePlaylist(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$this->playlists->deletePlaylist($userId, $id);
			return [];
		});
	}

	#[NoAdminRequired]
	public function addPlaylistItem(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$body = $this->getJsonBody();
			return ['playlist' => $this->playlists->addItem($userId, $id, (int)($body['fileId'] ?? 0))];
		});
	}

	#[NoAdminRequired]
	public function reorderPlaylistItems(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$body = $this->getJsonBody();
			$ids = is_array($body['itemIds'] ?? null) ? $body['itemIds'] : [];
			return ['playlist' => $this->playlists->reorderItems($userId, $id, array_map('intval', $ids))];
		});
	}

	#[NoAdminRequired]
	public function removePlaylistItem(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$this->playlists->removeItem($userId, $id);
			return [];
		});
	}

	#[NoAdminRequired]
	public function buildPlaylist(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$name = trim((string)($body['name'] ?? ''));
			$key = trim((string)($body['collectionKey'] ?? ''));
			if ($name === '' || $key === '') {
				throw new ValidationException('Name and collection key are required.');
			}
			return ['playlist' => $this->playlists->buildFromCollection($userId, $name, $key)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function listLibraries(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['libraries' => $this->library->listLibraries($userId)]);
	}

	#[NoAdminRequired]
	public function addLibrary(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$rootFileId = (int)($body['rootFileId'] ?? 0);
			$folderPath = isset($body['folderPath']) ? trim((string)$body['folderPath']) : null;
			if ($folderPath === '') {
				$folderPath = null;
			}
			if ($rootFileId < 1 && $folderPath === null) {
				throw new ValidationException('A valid folder is required.');
			}
			$result = $this->library->addLibrary(
				$userId,
				$rootFileId > 0 ? $rootFileId : null,
				(bool)($body['includeSubfolders'] ?? true),
				isset($body['contentKind']) ? (string)$body['contentKind'] : LibraryService::CONTENT_KIND_AUTO,
				$folderPath,
			);
			if ($result['rescanRecommended']) {
				$this->scan->queueScan($userId);
			}
			return $result;
		});
	}

	#[NoAdminRequired]
	public function updateLibrary(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$body = $this->getJsonBody();
			$includeSubfolders = array_key_exists('includeSubfolders', $body) ? (bool)$body['includeSubfolders'] : null;
			$contentKind = array_key_exists('contentKind', $body) ? (string)$body['contentKind'] : null;
			$result = $this->library->updateLibrary($userId, $id, $includeSubfolders, $contentKind);
			if ($result['rescanRecommended']) {
				$this->scan->queueScan($userId);
			}
			return $result;
		});
	}

	#[NoAdminRequired]
	public function removeLibrary(int $id): JSONResponse
	{
		return $this->safe(function (string $userId) use ($id): array {
			$this->library->removeLibrary($userId, $id);
			return [];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function scanStatus(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['scan' => $this->scan->getStatus($userId)]);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function scanAjaxCronTick(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->rateLimit->assertAllowed($userId, 'scan_ajax_cron', 120, 60);
			$this->scan->runAjaxCronScanBatch($userId);
			return ['scan' => $this->scan->getStatus($userId)];
		});
	}

	#[NoAdminRequired]
	public function triggerScan(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->rateLimit->assertAllowed($userId, 'scan', 3, 300);
			if (!$this->scan->hasConfiguredLibraries($userId)) {
				throw new ValidationException('Add a library folder before scanning.');
			}
			$this->scan->runInteractiveScan($userId);
			return ['scan' => $this->scan->getStatus($userId)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getPrefs(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['prefs' => $this->prefs->getPrefs($userId)]);
	}

	#[NoAdminRequired]
	public function savePrefs(): JSONResponse
	{
		return $this->safe(fn (string $userId): array => ['prefs' => $this->prefs->savePrefs($userId, $this->getJsonBody())]);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function searchUsers(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->access->requireAppAdmin();
			$this->rateLimit->assertAllowed($userId, 'user_search', 60, 60);
			$q = (string)$this->request->getParam('q', '');
			$users = array_values(array_filter(
				$this->access->searchUsers($q),
				static fn (array $u): bool => ($u['enabled'] ?? false) === true,
			));
			return ['users' => $users];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function searchGroups(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->access->requireAppAdmin();
			$this->rateLimit->assertAllowed($userId, 'group_search', 60, 60);
			$q = (string)$this->request->getParam('q', '');
			return ['groups' => $this->access->searchGroups($q)];
		});
	}

	#[NoAdminRequired]
	public function setFavorite(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			$body = $this->getJsonBody();
			return $this->library->setFavorite($userId, $fileId, (bool)($body['favorite'] ?? false));
		});
	}

	#[NoAdminRequired]
	public function setListened(int $fileId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($fileId): array {
			$body = $this->getJsonBody();
			return ['progress' => $this->playback->setListened($userId, $fileId, (bool)($body['listened'] ?? false))];
		});
	}

	#[NoAdminRequired]
	public function setListenedBulk(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$fileIds = is_array($body['fileIds'] ?? null) ? $body['fileIds'] : [];
			$result = $this->library->setListenedBulk($userId, array_map('intval', $fileIds), (bool)($body['listened'] ?? false));

			return array_merge($result, [
				'updatedCount' => $result['updated'],
			]);
		});
	}

	#[NoAdminRequired]
	public function setCollectionListened(string $key): JSONResponse
	{
		return $this->safe(function (string $userId) use ($key): array {
			$body = $this->getJsonBody();
			return $this->library->setCollectionListened($userId, $key, (bool)($body['listened'] ?? false));
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getFolderListenedStats(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$params = $this->request->getParams();
			$folder = isset($params['folder']) ? (string)$params['folder'] : '';
			$kind = isset($params['kind']) ? (string)$params['kind'] : null;
			$kindFilter = is_string($kind) && in_array($kind, [LibraryService::KIND_MUSIC, LibraryService::KIND_AUDIOBOOK], true)
				? $kind
				: null;

			return ['stats' => $this->library->getFolderPathListenedStats($userId, $folder, $kindFilter)];
		});
	}

	#[NoAdminRequired]
	public function setFolderPathListened(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$folder = trim((string)($body['folder'] ?? ''));
			$kind = isset($body['kind']) ? (string)$body['kind'] : null;
			$kindFilter = is_string($kind) && in_array($kind, [LibraryService::KIND_MUSIC, LibraryService::KIND_AUDIOBOOK], true)
				? $kind
				: null;

			return $this->library->setFolderPathListened($userId, $folder, $kindFilter, (bool)($body['listened'] ?? false));
		});
	}

	#[NoAdminRequired]
	public function setFolderListened(int $folderId): JSONResponse
	{
		return $this->safe(function (string $userId) use ($folderId): array {
			$body = $this->getJsonBody();

			return $this->library->setFolderIdListened($userId, $folderId, (bool)($body['listened'] ?? false));
		});
	}

	#[NoAdminRequired]
	public function queryListenedMap(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$body = $this->getJsonBody();
			$raw = $body['fileIds'] ?? [];
			if (!is_array($raw)) {
				throw new ValidationException('fileIds must be an array.');
			}
			$fileIds = array_values(array_filter(array_map('intval', $raw), static fn (int $id): bool => $id > 0));
			if ($fileIds === []) {
				return ['map' => []];
			}

			return ['map' => $this->library->queryListenedMap($userId, $fileIds)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getLibrarySyncState(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			return ['sync' => $this->library->getLibrarySyncState($userId)];
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getAppPolicy(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->access->requireAppAdmin();
			return ['policy' => $this->access->getAppPolicy()];
		});
	}

	#[NoAdminRequired]
	public function saveAppPolicy(): JSONResponse
	{
		return $this->safe(function (string $userId): array {
			$this->access->requireAppAdmin();
			$this->rateLimit->assertAllowed($userId, 'app_policy_save', 20, 300);
			return ['policy' => $this->access->saveAppPolicy($this->getJsonBody())];
		});
	}

	/** @return array<string, mixed> */
	private function getJsonBody(): array
	{
		$raw = file_get_contents('php://input');
		if ($raw === false || trim($raw) === '') {
			return [];
		}
		try {
			$data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			throw new ValidationException('Invalid JSON body.');
		}
		return is_array($data) ? $data : [];
	}

	/** @param callable(string): array<string, mixed> $operation */
	private function safe(callable $operation): JSONResponse
	{
		try {
			$userId = $this->access->currentUserId();
			return $this->ok($operation($userId));
		} catch (ValidationException $e) {
			$fields = $e->getFields();
			return $this->error($e->getMessage(), Http::STATUS_UNPROCESSABLE_ENTITY, 'invalid_input', $fields !== null ? ['fields' => $fields] : []);
		} catch (\InvalidArgumentException $e) {
			return $this->error($e->getMessage(), Http::STATUS_BAD_REQUEST, 'invalid_input');
		} catch (NotAuthenticatedException) {
			return $this->error('not_authenticated', Http::STATUS_UNAUTHORIZED, 'not_authenticated');
		} catch (AccessDeniedException) {
			return $this->error('access_denied', Http::STATUS_FORBIDDEN, 'access_denied');
		} catch (NotFoundException) {
			return $this->error('not_found', Http::STATUS_NOT_FOUND, 'not_found');
		} catch (RateLimitExceededException) {
			return $this->error('rate_limit_exceeded', Http::STATUS_TOO_MANY_REQUESTS, 'rate_limit_exceeded');
		} catch (InternalErrorException|AudioCheckException $e) {
			// Pass the exception object: the NC logger's PSR-3 interpolation
			// overwrites a custom 'message' context key, which would silently
			// drop all diagnostic detail from the log entry.
			$this->logger->error('AudioCheck API error', ['exception' => $e]);
			return $this->error('internal_error', Http::STATUS_INTERNAL_SERVER_ERROR, 'internal_error');
		} catch (\Throwable $e) {
			$this->logger->error('AudioCheck API unexpected error', ['exception' => $e]);
			return $this->error('internal_error', Http::STATUS_INTERNAL_SERVER_ERROR, 'internal_error');
		}
	}

	/** @param array<string, mixed> $data */
	private function ok(array $data): JSONResponse
	{
		return new JSONResponse(array_merge(['ok' => true], $data));
	}

	/** @param array<string, mixed> $extra */
	private function error(string $message, int $status, string $code, array $extra = []): JSONResponse
	{
		return new JSONResponse(array_merge([
			'ok' => false,
			'message' => $message,
			'error' => ['code' => $code],
		], $extra), $status);
	}
}
