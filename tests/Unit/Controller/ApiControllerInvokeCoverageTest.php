<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Controller {
	/**
	 * Unit harness: ApiController::getJsonBody() reads php://input via unqualified
	 * file_get_contents — PHP resolves the namespaced function first.
	 */
	function file_get_contents(string $filename, bool $use_include_path = false, $context = null, int $offset = 0, ?int $length = null): string|false
	{
		if ($filename === 'php://input') {
			return $GLOBALS['__AC_API_JSON_BODY'] ?? '';
		}
		if ($length === null) {
			return \file_get_contents($filename, $use_include_path, $context, $offset);
		}

		return \file_get_contents($filename, $use_include_path, $context, $offset, $length);
	}
}

namespace OCA\AudioCheck\Tests\Unit\Controller {

use OCA\AudioCheck\Controller\ApiController;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionClass;

/**
 * Used-function coverage: every public ApiController action is invoked (not CSRF regex theater).
 */
final class ApiControllerInvokeCoverageTest extends TestCase
{
	/** @var IRequest&MockObject */
	private IRequest $request;
	/** @var AccessControlService&MockObject */
	private AccessControlService $access;
	/** @var LibraryService&MockObject */
	private LibraryService $library;
	/** @var ScanService&MockObject */
	private ScanService $scan;
	/** @var PlaybackStateService&MockObject */
	private PlaybackStateService $playback;
	/** @var PlayQueueService&MockObject */
	private PlayQueueService $queue;
	/** @var PlaylistService&MockObject */
	private PlaylistService $playlists;
	/** @var UserPrefsService&MockObject */
	private UserPrefsService $prefs;
	/** @var RateLimitService&MockObject */
	private RateLimitService $rateLimit;

	private ApiController $controller;

	/** @var array<string, mixed> */
	private array $params = [];

	protected function setUp(): void
	{
		parent::setUp();
		$GLOBALS['__AC_API_JSON_BODY'] = '';
		$this->params = [];

		$this->request = $this->createMock(IRequest::class);
		$this->request->method('getParams')->willReturnCallback(fn (): array => $this->params);
		$this->request->method('getParam')->willReturnCallback(
			function (string $key, $default = null) {
				return array_key_exists($key, $this->params) ? $this->params[$key] : $default;
			}
		);

		$this->access = $this->createMock(AccessControlService::class);
		$this->access->method('currentUserId')->willReturn('alice');
		$this->access->method('requireAppAdmin')->willReturn('alice');
		$this->access->method('getAppPolicy')->willReturn(['appAdminUserIds' => ['alice']]);
		$this->access->method('saveAppPolicy')->willReturn(['appAdminUserIds' => ['alice']]);
		$this->access->method('searchUsers')->willReturn([['id' => 'alice', 'enabled' => true]]);
		$this->access->method('searchGroups')->willReturn([['id' => 'admin']]);

		$track = ['fileId' => 42, 'title' => 'Track'];
		$collection = ['key' => 'k', 'title' => 'Album', 'tracks' => []];
		$playlist = ['id' => 7, 'name' => 'P', 'items' => []];
		$library = ['id' => 3, 'folderPath' => '/Music', 'alreadyExisted' => false, 'rescanRecommended' => true];
		$scanStatus = ['state' => 'idle'];
		$prefs = ['defaultSpeed' => 100];
		$progress = ['fileId' => 42, 'positionMs' => 1];
		$queue = ['fileIds' => [42], 'currentIndex' => 0];

		$this->library = $this->createMock(LibraryService::class);
		$this->library->method('listTracks')->willReturn(['items' => [$track], 'total' => 1]);
		$this->library->method('getTrackInfo')->willReturn($track);
		$this->library->method('getPlayableTrack')->willReturn($track);
		$this->library->method('listFolderTracks')->willReturn(['items' => [$track]]);
		$this->library->method('listCollections')->willReturn(['items' => [$collection]]);
		$this->library->method('getCollection')->willReturn($collection);
		$this->library->method('listFacets')->willReturn(['items' => []]);
		$this->library->method('listLibraries')->willReturn([$library]);
		$this->library->method('addLibrary')->willReturn($library);
		$this->library->method('updateLibrary')->willReturn($library);
		$this->library->method('removeLibrary')->willReturnCallback(static function (): void {});
		$this->library->method('setFavorite')->willReturn(['favorite' => true]);
		$this->library->method('setListenedBulk')->willReturn(['updated' => 1]);
		$this->library->method('setCollectionListened')->willReturn(['updated' => 1]);
		$this->library->method('getFolderPathListenedStats')->willReturn(['total' => 1, 'listened' => 0]);
		$this->library->method('setFolderPathListened')->willReturn(['updated' => 1]);
		$this->library->method('setFolderIdListened')->willReturn(['updated' => 1]);
		$this->library->method('queryListenedMap')->willReturn([42 => false]);
		$this->library->method('getLibrarySyncState')->willReturn(['revision' => 1]);

		$this->scan = $this->createMock(ScanService::class);
		$this->scan->method('getStatus')->willReturn($scanStatus);
		$this->scan->method('hasConfiguredLibraries')->willReturn(true);
		$this->scan->method('queueScan')->willReturnCallback(static function (): void {});
		$this->scan->method('runInteractiveScan')->willReturnCallback(static function (): void {});
		$this->scan->method('runAjaxCronScanBatch')->willReturnCallback(static function (): void {});
		$this->scan->method('purgeTracksOutsideLibraries')->willReturn(0);

		$this->playback = $this->createMock(PlaybackStateService::class);
		$this->playback->method('getProgress')->willReturn($progress);
		$this->playback->method('saveProgress')->willReturn($progress);
		$this->playback->method('deleteProgress')->willReturnCallback(static function (): void {});
		$this->playback->method('setListened')->willReturn($progress);

		$this->queue = $this->createMock(PlayQueueService::class);
		$this->queue->method('getQueue')->willReturn($queue);
		$this->queue->method('saveQueue')->willReturn($queue);
		$this->queue->method('clearQueue')->willReturnCallback(static function (): void {});

		$this->playlists = $this->createMock(PlaylistService::class);
		$this->playlists->method('listPlaylists')->willReturn([$playlist]);
		$this->playlists->method('createPlaylist')->willReturn($playlist);
		$this->playlists->method('getPlaylist')->willReturn($playlist);
		$this->playlists->method('updatePlaylist')->willReturn($playlist);
		$this->playlists->method('deletePlaylist')->willReturnCallback(static function (): void {});
		$this->playlists->method('addItem')->willReturn($playlist);
		$this->playlists->method('reorderItems')->willReturn($playlist);
		$this->playlists->method('removeItem')->willReturnCallback(static function (): void {});
		$this->playlists->method('buildFromCollection')->willReturn($playlist);

		$this->prefs = $this->createMock(UserPrefsService::class);
		$this->prefs->method('getPrefs')->willReturn($prefs);
		$this->prefs->method('savePrefs')->willReturn($prefs);

		$this->rateLimit = $this->createMock(RateLimitService::class);
		$this->rateLimit->method('assertAllowed')->willReturnCallback(static function (): void {});

		$this->controller = new ApiController(
			'audiocheck',
			$this->request,
			$this->access,
			$this->library,
			$this->scan,
			$this->playback,
			$this->queue,
			$this->playlists,
			$this->prefs,
			$this->rateLimit,
			$this->createMock(LoggerInterface::class),
		);
	}

	protected function tearDown(): void
	{
		unset($GLOBALS['__AC_API_JSON_BODY']);
		parent::tearDown();
	}

	private function setJsonBody(array $body): void
	{
		$GLOBALS['__AC_API_JSON_BODY'] = json_encode($body, JSON_THROW_ON_ERROR);
	}

	private function assertOk(JSONResponse $response, string $label): void
	{
		self::assertSame(Http::STATUS_OK, $response->getStatus(), $label . ' status');
		$data = $response->getData();
		self::assertTrue($data['ok'] ?? false, $label . ' ok flag');
	}

	/** @return list<string> */
	private function publicActions(): array
	{
		$ref = new ReflectionClass(ApiController::class);
		$names = [];
		foreach ($ref->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
			if ($method->getDeclaringClass()->getName() !== ApiController::class) {
				continue;
			}
			if ($method->getName() === '__construct') {
				continue;
			}
			$names[] = $method->getName();
		}
		sort($names);

		return $names;
	}

	public function testEveryPublicActionIsInvokedWithHappyPath(): void
	{
		$invoked = [];

		$this->params = [];
		$this->assertOk($this->controller->listTracks(), 'listTracks');
		$invoked[] = 'listTracks';

		$this->assertOk($this->controller->getTrackInfo(42), 'getTrackInfo');
		$invoked[] = 'getTrackInfo';

		$this->assertOk($this->controller->getPlayableTrack(42), 'getPlayableTrack');
		$invoked[] = 'getPlayableTrack';

		$this->assertOk($this->controller->listFolderTracks(9), 'listFolderTracks');
		$invoked[] = 'listFolderTracks';

		$this->assertOk($this->controller->listCollections(), 'listCollections');
		$invoked[] = 'listCollections';

		$this->assertOk($this->controller->getCollection('k'), 'getCollection');
		$invoked[] = 'getCollection';

		$this->assertOk($this->controller->listFacets('genre'), 'listFacets');
		$invoked[] = 'listFacets';

		$this->assertOk($this->controller->getProgress(), 'getProgress');
		$invoked[] = 'getProgress';

		$this->setJsonBody(['positionMs' => 10, 'playbackSpeed' => 100, 'durationMs' => 1000]);
		$this->assertOk($this->controller->saveProgress(42), 'saveProgress');
		$invoked[] = 'saveProgress';

		$this->setJsonBody(['positionMs' => 11]);
		$this->assertOk($this->controller->saveProgressBeacon(42), 'saveProgressBeacon');
		$invoked[] = 'saveProgressBeacon';

		$this->assertOk($this->controller->deleteProgress(42), 'deleteProgress');
		$invoked[] = 'deleteProgress';

		$this->assertOk($this->controller->getQueue(), 'getQueue');
		$invoked[] = 'getQueue';

		$this->setJsonBody(['fileIds' => [42], 'currentIndex' => 0]);
		$this->assertOk($this->controller->saveQueue(), 'saveQueue');
		$invoked[] = 'saveQueue';

		$this->setJsonBody(['fileIds' => [42]]);
		$this->assertOk($this->controller->saveQueueBeacon(), 'saveQueueBeacon');
		$invoked[] = 'saveQueueBeacon';

		$this->assertOk($this->controller->clearQueue(), 'clearQueue');
		$invoked[] = 'clearQueue';

		$this->assertOk($this->controller->listPlaylists(), 'listPlaylists');
		$invoked[] = 'listPlaylists';

		$this->setJsonBody(['name' => 'P']);
		$this->assertOk($this->controller->createPlaylist(), 'createPlaylist');
		$invoked[] = 'createPlaylist';

		$this->assertOk($this->controller->getPlaylist(7), 'getPlaylist');
		$invoked[] = 'getPlaylist';

		$this->setJsonBody(['name' => 'P2']);
		$this->assertOk($this->controller->updatePlaylist(7), 'updatePlaylist');
		$invoked[] = 'updatePlaylist';

		$this->assertOk($this->controller->deletePlaylist(7), 'deletePlaylist');
		$invoked[] = 'deletePlaylist';

		$this->setJsonBody(['fileId' => 42]);
		$this->assertOk($this->controller->addPlaylistItem(7), 'addPlaylistItem');
		$invoked[] = 'addPlaylistItem';

		$this->setJsonBody(['itemIds' => [1, 2]]);
		$this->assertOk($this->controller->reorderPlaylistItems(7), 'reorderPlaylistItems');
		$invoked[] = 'reorderPlaylistItems';

		$this->assertOk($this->controller->removePlaylistItem(1), 'removePlaylistItem');
		$invoked[] = 'removePlaylistItem';

		$this->setJsonBody(['name' => 'Built', 'collectionKey' => 'k']);
		$this->assertOk($this->controller->buildPlaylist(), 'buildPlaylist');
		$invoked[] = 'buildPlaylist';

		$this->assertOk($this->controller->listLibraries(), 'listLibraries');
		$invoked[] = 'listLibraries';

		$this->setJsonBody(['folderPath' => '/Music', 'includeSubfolders' => true]);
		$this->assertOk($this->controller->addLibrary(), 'addLibrary');
		$invoked[] = 'addLibrary';

		$this->setJsonBody(['includeSubfolders' => false]);
		$this->assertOk($this->controller->updateLibrary(3), 'updateLibrary');
		$invoked[] = 'updateLibrary';

		$this->assertOk($this->controller->removeLibrary(3), 'removeLibrary');
		$invoked[] = 'removeLibrary';

		$this->assertOk($this->controller->scanStatus(), 'scanStatus');
		$invoked[] = 'scanStatus';

		$this->assertOk($this->controller->scanAjaxCronTick(), 'scanAjaxCronTick');
		$invoked[] = 'scanAjaxCronTick';

		$this->assertOk($this->controller->triggerScan(), 'triggerScan');
		$invoked[] = 'triggerScan';

		$this->assertOk($this->controller->getPrefs(), 'getPrefs');
		$invoked[] = 'getPrefs';

		$this->setJsonBody(['defaultSpeed' => 125]);
		$this->assertOk($this->controller->savePrefs(), 'savePrefs');
		$invoked[] = 'savePrefs';

		$this->params = ['q' => 'al'];
		$this->assertOk($this->controller->searchUsers(), 'searchUsers');
		$invoked[] = 'searchUsers';

		$this->params = ['q' => 'ad'];
		$this->assertOk($this->controller->searchGroups(), 'searchGroups');
		$invoked[] = 'searchGroups';

		$this->setJsonBody(['favorite' => true]);
		$this->assertOk($this->controller->setFavorite(42), 'setFavorite');
		$invoked[] = 'setFavorite';

		$this->setJsonBody(['listened' => true]);
		$this->assertOk($this->controller->setListened(42), 'setListened');
		$invoked[] = 'setListened';

		$this->setJsonBody(['fileIds' => [42], 'listened' => true]);
		$this->assertOk($this->controller->setListenedBulk(), 'setListenedBulk');
		$invoked[] = 'setListenedBulk';

		$this->setJsonBody(['listened' => true]);
		$this->assertOk($this->controller->setCollectionListened('k'), 'setCollectionListened');
		$invoked[] = 'setCollectionListened';

		$this->params = ['folder' => '/Music'];
		$this->assertOk($this->controller->getFolderListenedStats(), 'getFolderListenedStats');
		$invoked[] = 'getFolderListenedStats';

		$this->setJsonBody(['folder' => '/Music', 'listened' => false]);
		$this->assertOk($this->controller->setFolderPathListened(), 'setFolderPathListened');
		$invoked[] = 'setFolderPathListened';

		$this->setJsonBody(['listened' => false]);
		$this->assertOk($this->controller->setFolderListened(9), 'setFolderListened');
		$invoked[] = 'setFolderListened';

		$this->setJsonBody(['fileIds' => [42]]);
		$this->assertOk($this->controller->queryListenedMap(), 'queryListenedMap');
		$invoked[] = 'queryListenedMap';

		$this->params = [];
		$this->assertOk($this->controller->getLibrarySyncState(), 'getLibrarySyncState');
		$invoked[] = 'getLibrarySyncState';

		$this->assertOk($this->controller->getAppPolicy(), 'getAppPolicy');
		$invoked[] = 'getAppPolicy';

		$this->setJsonBody(['appAdminUserIds' => ['alice']]);
		$this->assertOk($this->controller->saveAppPolicy(), 'saveAppPolicy');
		$invoked[] = 'saveAppPolicy';

		sort($invoked);
		$public = $this->publicActions();
		self::assertSame(
			$public,
			$invoked,
			'Every public ApiController action must be invoked. Missing: '
			. implode(',', array_diff($public, $invoked))
			. ' Extra: ' . implode(',', array_diff($invoked, $public))
		);
	}
}

}
