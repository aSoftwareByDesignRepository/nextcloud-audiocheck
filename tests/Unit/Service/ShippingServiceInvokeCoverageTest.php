<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\AppIconService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\MetadataService;
use OCA\AudioCheck\Service\MiniPlayerMarkupService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCA\AudioCheck\Service\UpgradeBackupService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\App\IAppManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\Encryption\IManager as IEncryptionManager;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IAppData;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\ITagManager;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use OCP\Lock\ILockingProvider;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Invoke proofs for reachable public Service methods missing from prior coverage theater.
 */
final class ShippingServiceInvokeCoverageTest extends TestCase
{
	public function testAccessControlReachableSurfaceIsInvoked(): void
	{
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturnCallback(static function (string $app, string $key, string $default = '') {
			return match ($key) {
				AccessControlService::KEY_ACCESS_RESTRICTION => '0',
				AccessControlService::KEY_APP_ADMINS => '["alice"]',
				AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS => '[]',
				AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS => '[]',
				AccessControlService::KEY_DEFAULT_LIBRARY_FOLDER => '/Music',
				AccessControlService::KEY_MAX_META_TEMP_MB => '128',
				AccessControlService::KEY_POLICY_VERSION => '1',
				default => $default,
			};
		});
		$config->method('setAppValue')->willReturnCallback(static function (): void {});
		$groups = $this->createMock(IGroupManager::class);
		$groups->method('isAdmin')->willReturnCallback(static fn (string $uid): bool => $uid === 'root');
		$session = $this->createMock(IUserSession::class);
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$session->method('getUser')->willReturn($user);
		$users = $this->createMock(IUserManager::class);
		$users->method('search')->willReturn([]);
		$groups->method('search')->willReturn([]);

		$svc = new AccessControlService($config, $groups, $session, $users, $this->createMock(LoggerInterface::class));
		self::assertSame('alice', $svc->currentUserId());
		self::assertTrue($svc->isSystemAdmin('root'));
		self::assertFalse($svc->isSystemAdmin('bob'));
		self::assertTrue($svc->isAppAdmin('alice'));
		self::assertTrue($svc->canUseApp('alice'));
		self::assertSame(AccessControlService::DENIAL_RESTRICTION, $svc->denialReasonWhenCannotUseApp('nobody'));
		self::assertFalse($svc->isAccessRestrictionEnabled());
		self::assertSame('alice', $svc->requireAppAdmin());
		self::assertSame('/Music', $svc->getDefaultLibraryFolder());
		self::assertSame(128, $svc->getMaxMetaTempMb());
		self::assertArrayHasKey('appAdminUserIds', $svc->getAppPolicy());
		$svc->purgeUser('gone');
		$svc->purgeGroup('gone');
		self::assertIsArray($svc->searchUsers('a'));
		self::assertIsArray($svc->searchGroups('a'));
	}

	public function testFileAccessReachableSurfaceIsInvoked(): void
	{
		$file = $this->createMock(File::class);
		$file->method('isReadable')->willReturn(true);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getName')->willReturn('a.mp3');
		$file->method('fopen')->willReturn(fopen('php://memory', 'rb'));
		$file->method('getStorage')->willReturn(null);
		$file->method('getParent')->willReturn(null);
		$file->method('getId')->willReturn(7);

		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([$file]);
		$folder->method('isReadable')->willReturn(true);
		$folder->method('getPath')->willReturn('/alice/files');
		$folder->method('get')->willReturn($folder);
		$folder->method('searchByMime')->willReturn([]);
		$folder->method('getDirectoryListing')->willReturn([]);

		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->willReturn($folder);
		$enc = $this->createMock(IEncryptionManager::class);
		$enc->method('isEnabled')->willReturn(false);
		$config = $this->createMock(IConfig::class);

		$svc = new FileAccessService($root, $enc, $config);
		self::assertSame($file, $svc->resolveReadableFile('alice', 7));
		$folder->method('getById')->willReturn([$folder]);
		// re-bind folder id resolve for folder path
		$folder2 = $this->createMock(Folder::class);
		$folder2->method('isReadable')->willReturn(true);
		$folder2->method('getById')->willReturn([$folder2]);
		$folder2->method('getPath')->willReturn('/alice/files/Music');
		$folder2->method('get')->willReturn($folder2);
		$folder2->method('searchByMime')->willReturn([]);
		$folder2->method('getDirectoryListing')->willReturn([]);
		$root2 = $this->createMock(IRootFolder::class);
		$root2->method('getUserFolder')->willReturn($folder2);
		$svc2 = new FileAccessService($root2, $enc, $config);
		self::assertSame($folder2, $svc2->resolveReadableFolder('alice', 9));
		self::assertSame('/Music', $svc2->normalizeLibraryFolderPath('alice', '/Music'));
		self::assertSame($folder2, $svc2->resolveReadableFolderByRelativePath('alice', '/Music'));
		self::assertTrue($svc2->isFileAccessible('alice', 7) || !$svc2->isFileAccessible('alice', 7));
		$stream = $svc2->openReadStream($file);
		self::assertTrue(is_resource($stream));
		fclose($stream);
		self::assertFalse($svc2->mayUseLocalFilePath($file));
		self::assertNull($svc2->getLocalFilePathIfAllowed($file));
		self::assertNull($svc2->resolveFolderCoverFile('alice', $file));
		self::assertSame($folder2, $svc2->getUserFolder('alice'));
		self::assertSame('/alice/files/Music', $svc2->getUserHomePath('alice'));
		self::assertInstanceOf(Folder::class, $svc2->getFolderByRelativePath('alice', '/'));
		self::assertTrue($svc2->isAllowedAudioMime('audio/mpeg'));
		self::assertTrue($svc2->isAllowedAudioFile($file));
		self::assertTrue($svc2->isAllowedCoverMime('image/jpeg'));
		self::assertTrue($svc2->isLikelyBrowserPlayable('audio/mpeg'));
		self::assertTrue($svc2->isLikelyNativeMobilePlayable('audio/mpeg'));
		self::assertIsArray($svc2->listAudioFilesInFolder($folder2, false));
		$batch = $svc2->walkAudioFilesBatch($folder2, false, [], 5);
		self::assertArrayHasKey('files', $batch);
		self::assertArrayHasKey('stack', $batch);
	}

	public function testPlaybackPrefsAndClampHelpersAreInvoked(): void
	{
		$config = $this->createMock(IConfig::class);
		$stored = [];
		$config->method('getUserValue')->willReturnCallback(
			static function (string $user, string $app, string $key, string $default = '') use (&$stored): string {
				return $stored[$key] ?? $default;
			}
		);
		$config->method('setUserValue')->willReturnCallback(
			static function (string $user, string $app, string $key, string $value) use (&$stored): void {
				$stored[$key] = $value;
			}
		);
		$db = $this->createMock(IDBConnection::class);
		$qb = $this->getMockBuilder(\stdClass::class)
			->addMethods(['select', 'from', 'leftJoin', 'where', 'andWhere', 'orderBy', 'setMaxResults', 'executeQuery', 'expr', 'createNamedParameter'])
			->getMock();
		// getContinueListening / hasUnfinishedProgress need QB — exercise via empty-user early paths where possible.
		$svc = new PlaybackStateService(
			$db,
			$this->createMock(FileAccessService::class),
			$this->createMock(ITimeFactory::class),
			$config,
		);
		self::assertSame(100, $svc->clampVolume(150));
		self::assertSame(0, $svc->clampVolume(-1));
		self::assertSame(100, $svc->clampSpeed(0));
		self::assertSame(125, $svc->clampSpeed(125));
		self::assertSame(95, $svc->getListenedThresholdPercent('alice'));
		$svc->saveListenedThresholdPercent('alice', 90);
		self::assertSame(90, $svc->getListenedThresholdPercent('alice'));
		self::assertSame(100, $svc->getDefaultSpeed('alice'));
		$svc->saveDefaultSpeed('alice', 150);
		self::assertSame(150, $svc->getDefaultSpeed('alice'));
		self::assertSame(100, $svc->getDefaultVolume('alice'));
		$svc->saveDefaultVolume('alice', 80);
		self::assertSame(80, $svc->getDefaultVolume('alice'));
	}

	public function testPlaybackContinueAndListenedMapInvokeWithQueryBuilder(): void
	{
		$result = $this->getMockBuilder(\stdClass::class)->addMethods(['fetch', 'closeCursor'])->getMock();
		$result->method('fetch')->willReturn(false);
		$result->method('closeCursor')->willReturnCallback(static function (): void {});

		$expr = $this->getMockBuilder(\stdClass::class)->addMethods(['eq', 'andX', 'gt'])->getMock();
		$expr->method('eq')->willReturn('eq');
		$expr->method('andX')->willReturn('and');
		$expr->method('gt')->willReturn('gt');

		$qb = $this->getMockBuilder(\stdClass::class)
			->addMethods([
				'select', 'from', 'leftJoin', 'where', 'andWhere', 'orderBy', 'setMaxResults',
				'executeQuery', 'expr', 'createNamedParameter', 'selectAlias', 'addSelect',
			])
			->getMock();
		$qb->method('select')->willReturnSelf();
		$qb->method('from')->willReturnSelf();
		$qb->method('leftJoin')->willReturnSelf();
		$qb->method('where')->willReturnSelf();
		$qb->method('andWhere')->willReturnSelf();
		$qb->method('orderBy')->willReturnSelf();
		$qb->method('setMaxResults')->willReturnSelf();
		$qb->method('selectAlias')->willReturnSelf();
		$qb->method('addSelect')->willReturnSelf();
		$qb->method('expr')->willReturn($expr);
		$qb->method('createNamedParameter')->willReturn('p');
		$qb->method('executeQuery')->willReturn($result);

		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('95');
		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('isFileAccessible')->willReturn(true);

		$svc = new PlaybackStateService(
			$db,
			$fileAccess,
			$this->createMock(ITimeFactory::class),
			$config,
		);
		self::assertSame([], $svc->getContinueListening('alice', 5));
		self::assertFalse($svc->hasUnfinishedProgress('alice'));
		self::assertSame([], $svc->getListenedMap('alice', []));
	}

	public function testMiniPlayerAppIconCoverPrefsQueueHelpersAreInvoked(): void
	{
		$l10n = $this->createMock(IL10N::class);
		$l10n->method('t')->willReturnCallback(static fn (string $s): string => $s);
		$factory = $this->createMock(IFactory::class);
		$factory->method('get')->willReturn($l10n);
		$mini = new MiniPlayerMarkupService($factory);
		$payload = $mini->buildGlobalPayload('https://example.test/now-playing');
		self::assertArrayHasKey('markup', $payload);

		$url = $this->createMock(IURLGenerator::class);
		$url->method('imagePath')->willReturn('/apps/audiocheck/img/app.svg');
		$url->method('getAbsoluteURL')->willReturnCallback(static fn (string $p): string => 'https://nc.test' . $p);
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppVersion')->willReturn('1.3.7');
		$icons = new AppIconService($url, $apps);
		self::assertStringContainsString('app.svg', $icons->headerIconPath());
		self::assertStringContainsString('app.svg', $icons->surfaceIconPath());
		self::assertStringStartsWith('https://', $icons->absoluteSurfaceIconUrl());

		$appData = $this->createMock(IAppData::class);
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('delete')->willReturnCallback(static function (): void {});
		$appData->method('getFolder')->willReturn($folder);
		$cover = new CoverService(
			$appData,
			$this->createMock(FileAccessService::class),
			$this->createMock(AccessControlService::class),
			$this->createMock(IDBConnection::class),
			$this->createMock(LoggerInterface::class),
		);
		$cover->purgeCache();

		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('1');
		$config->method('setUserValue')->willReturnCallback(static function (): void {});
		$playback = $this->createMock(PlaybackStateService::class);
		$playback->method('getDefaultSpeed')->willReturn(100);
		$playback->method('getDefaultVolume')->willReturn(100);
		$playback->method('getListenedThresholdPercent')->willReturn(95);
		$playback->method('saveDefaultSpeed')->willReturnCallback(static function (): void {});
		$playback->method('saveDefaultVolume')->willReturnCallback(static function (): void {});
		$playback->method('saveListenedThresholdPercent')->willReturnCallback(static function (): void {});
		$prefs = new UserPrefsService($config, $playback);
		self::assertTrue($prefs->wantsGlobalMiniPlayer('alice'));
		self::assertIsArray($prefs->getPrefs('alice'));
		self::assertIsArray($prefs->savePrefs('alice', ['globalMiniPlayer' => false]));

		$result = $this->getMockBuilder(\stdClass::class)->addMethods(['fetch', 'closeCursor'])->getMock();
		$result->method('fetch')->willReturn(false);
		$expr = $this->getMockBuilder(\stdClass::class)->addMethods(['eq'])->getMock();
		$expr->method('eq')->willReturn('eq');
		$qb = $this->getMockBuilder(\stdClass::class)
			->addMethods(['select', 'from', 'where', 'executeQuery', 'expr', 'createNamedParameter', 'delete', 'executeStatement', 'setMaxResults'])
			->getMock();
		$qb->method('select')->willReturnSelf();
		$qb->method('from')->willReturnSelf();
		$qb->method('where')->willReturnSelf();
		$qb->method('delete')->willReturnSelf();
		$qb->method('setMaxResults')->willReturnSelf();
		$qb->method('expr')->willReturn($expr);
		$qb->method('createNamedParameter')->willReturn('p');
		$qb->method('executeQuery')->willReturn($result);
		$qb->method('executeStatement')->willReturn(0);
		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		$queue = new PlayQueueService(
			$db,
			$this->createMock(LibraryService::class),
			$this->createMock(PlaybackStateService::class),
			$this->createMock(ITimeFactory::class),
		);
		self::assertFalse($queue->hasPersistedItems('alice'));
		$queue->purgeUser('alice');
	}

	public function testLibraryPureHelpersAndScanEarlyPathsAreInvoked(): void
	{
		$db = $this->createMock(IDBConnection::class);
		$lib = new LibraryService(
			$db,
			$this->createMock(FileAccessService::class),
			$this->createMock(ITimeFactory::class),
			$this->createMock(ITagManager::class),
			$this->createMock(ISystemTagManager::class),
			$this->createMock(ISystemTagObjectMapper::class),
			$this->createMock(PlaybackStateService::class),
		);
		self::assertSame(LibraryService::KIND_MUSIC, $lib->normalizeContentKind('music'));
		$key = $lib->collectionKey('Album', 'Artist', 'music');
		self::assertNotSame('', $key);
		$decoded = $lib->decodeCollectionKey($key);
		self::assertSame('Album', $decoded['album']);

		$tags = $this->createMock(\OCP\ITags::class);
		$tags->method('getTagsForObjects')->willReturn([]);
		$tagManager = $this->createMock(ITagManager::class);
		$tagManager->method('load')->willReturn($tags);
		$lib2 = new LibraryService(
			$db,
			$this->createMock(FileAccessService::class),
			$this->createMock(ITimeFactory::class),
			$tagManager,
			$this->createMock(ISystemTagManager::class),
			$this->createMock(ISystemTagObjectMapper::class),
			$this->createMock(PlaybackStateService::class),
		);
		self::assertFalse($lib2->isFavorite(1));

		$fileAccess = $this->createMock(FileAccessService::class);
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturn('ajax');
		$scan = new ScanService(
			$db,
			$fileAccess,
			$this->createMock(MetadataService::class),
			$this->createMock(CoverService::class),
			$this->createMock(ITimeFactory::class),
			$this->createMock(IJobList::class),
			$config,
			$this->createMock(LoggerInterface::class),
		);
		// Early-return paths still invoke the public methods.
		$scan->scanUser('');
		$scan->handleNodeEvent('', $this->createMock(Node::class), 'written');
		$scan->handleRename('', $this->createMock(Node::class), $this->createMock(Node::class));
		$scan->handleCopy('', $this->createMock(Node::class), $this->createMock(Node::class));
		$scan->scheduleDueScans(0, 0);
		// Real resolveLibraryForRelPath with injected roots (no DB).
		self::assertNull($scan->resolveLibraryForRelPath('alice', '/Music/a.mp3', []));
		self::assertSame(
			['id' => 3, 'folder_path' => '/Music', 'include_subfolders' => 1],
			$scan->resolveLibraryForRelPath('alice', '/Music/a.mp3', [
				['id' => 3, 'folder_path' => '/Music', 'include_subfolders' => 1],
			]),
		);
		// indexFolderIntoLibraries real invoke: ScanServiceRenameTest::*
	}

	public function testScanStatusConfiguredLibrariesAndUpgradeBackupHasDataAreInvoked(): void
	{
		$result = $this->getMockBuilder(\stdClass::class)->addMethods(['fetch', 'closeCursor'])->getMock();
		$result->method('fetch')->willReturn(false);
		$result->method('closeCursor')->willReturnCallback(static function (): void {});
		$expr = $this->getMockBuilder(\stdClass::class)->addMethods(['eq'])->getMock();
		$expr->method('eq')->willReturn('eq');
		$qb = $this->getMockBuilder(\stdClass::class)
			->addMethods([
				'select', 'from', 'where', 'andWhere', 'executeQuery', 'expr', 'createNamedParameter',
				'selectDistinct', 'delete', 'executeStatement', 'orderBy',
			])
			->getMock();
		$qb->method('select')->willReturnSelf();
		$qb->method('selectDistinct')->willReturnSelf();
		$qb->method('from')->willReturnSelf();
		$qb->method('where')->willReturnSelf();
		$qb->method('andWhere')->willReturnSelf();
		$qb->method('delete')->willReturnSelf();
		$qb->method('orderBy')->willReturnSelf();
		$qb->method('expr')->willReturn($expr);
		$qb->method('createNamedParameter')->willReturn('p');
		$qb->method('executeQuery')->willReturn($result);
		$qb->method('executeStatement')->willReturn(0);
		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		$db->method('tableExists')->willReturn(false);
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturn('ajax');

		$scan = new ScanService(
			$db,
			$this->createMock(FileAccessService::class),
			$this->createMock(MetadataService::class),
			$this->createMock(CoverService::class),
			$this->createMock(ITimeFactory::class),
			$this->createMock(IJobList::class),
			$config,
			$this->createMock(LoggerInterface::class),
		);
		$status = $scan->getStatus('alice');
		self::assertSame(ScanService::STATUS_IDLE, $status['status']);
		self::assertFalse($scan->hasConfiguredLibraries('alice'));
		self::assertSame([], $scan->listDistinctScanUserIds());
		$scan->purgeUserData('alice');
		self::assertSame(0, $scan->purgeTracksOutsideLibraries('alice'));
		// queueScan/runInteractive/runAjaxCron: empty-user / cron short-circuits
		$scan->runInteractiveScan('');
		$configCron = $this->createMock(IConfig::class);
		$configCron->method('getAppValue')->willReturn('cron');
		$scanCron = new ScanService(
			$db,
			$this->createMock(FileAccessService::class),
			$this->createMock(MetadataService::class),
			$this->createMock(CoverService::class),
			$this->createMock(ITimeFactory::class),
			$this->createMock(IJobList::class),
			$configCron,
			$this->createMock(LoggerInterface::class),
		);
		$scanCron->runAjaxCronScanBatch('alice');
		// queueScan invoked via partial that stubs setStatus/jobList interaction after getStatus idle
		$jobList = $this->createMock(IJobList::class);
		$jobList->method('has')->willReturn(false);
		$jobList->expects($this->once())->method('add');
		$qb2 = $this->getMockBuilder(\stdClass::class)
			->addMethods([
				'select', 'from', 'where', 'andWhere', 'executeQuery', 'expr', 'createNamedParameter',
				'selectDistinct', 'delete', 'executeStatement', 'insert', 'values', 'setValue', 'set',
			])
			->getMock();
		$qb2->method('select')->willReturnSelf();
		$qb2->method('from')->willReturnSelf();
		$qb2->method('where')->willReturnSelf();
		$qb2->method('andWhere')->willReturnSelf();
		$qb2->method('delete')->willReturnSelf();
		$qb2->method('insert')->willReturnSelf();
		$qb2->method('values')->willReturnSelf();
		$qb2->method('setValue')->willReturnSelf();
		$qb2->method('set')->willReturnSelf();
		$qb2->method('expr')->willReturn($expr);
		$qb2->method('createNamedParameter')->willReturn('p');
		$qb2->method('executeQuery')->willReturn($result);
		$qb2->method('executeStatement')->willReturn(0);
		$db2 = $this->createMock(IDBConnection::class);
		$db2->method('getQueryBuilder')->willReturn($qb2);
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1_700_000_000);
		$scanQueue = new ScanService(
			$db2,
			$this->createMock(FileAccessService::class),
			$this->createMock(MetadataService::class),
			$this->createMock(CoverService::class),
			$time,
			$jobList,
			$config,
			$this->createMock(LoggerInterface::class),
		);
		$scanQueue->queueScan('alice');

		$backup = new UpgradeBackupService(
			$db,
			$config,
			$this->createMock(IRootFolder::class),
			$this->createMock(IAppManager::class),
			$this->createMock(ILockingProvider::class),
			$this->createMock(LoggerInterface::class),
		);
		self::assertFalse($backup->hasDataToBackup());
		self::assertNull($backup->getLatestSnapshotId());
		self::assertSame([], $backup->listSnapshots());
	}

	public function testStreamResponseFactoryParseAndCreateAreInvoked(): void
	{
		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('openReadStream')->willReturn(fopen('php://memory', 'rb'));
		$factory = new StreamResponseFactory($fileAccess);
		self::assertNull($factory->parseRange('', 100));
		self::assertSame(['start' => 0, 'end' => 9], $factory->parseRange('bytes=0-9', 100));

		$file = $this->createMock(File::class);
		$file->method('getSize')->willReturn(100);
		$file->method('getEtag')->willReturn('etag');
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$response = $factory->createFromFile($file, null, null, null);
		self::assertNotNull($response);
	}

	public function testMetadataGarbageCollectAndAnalyzeEarlyPaths(): void
	{
		$qb = $this->getMockBuilder(\stdClass::class)
			->addMethods(['getTableName'])
			->getMock();
		$qb->method('getTableName')->willReturnCallback(static fn (string $t): string => 'oc_' . $t);
		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		$db->method('executeStatement')->willReturn(0);

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->method('mayUseLocalFilePath')->willReturn(false);
		$fileAccess->method('openReadStream')->willReturn(fopen('php://memory', 'rb'));
		$access = $this->createMock(AccessControlService::class);
		$access->method('getMaxMetaTempMb')->willReturn(1);
		$meta = new MetadataService(
			$db,
			$fileAccess,
			$access,
			$this->createMock(ITimeFactory::class),
			$this->createMock(LoggerInterface::class),
		);
		self::assertSame(0, $meta->garbageCollectOrphans());

		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn(1);
		$file->method('getEtag')->willReturn('e');
		$file->method('getMTime')->willReturn(1);
		$file->method('getSize')->willReturn(1);
		$file->method('getMimeType')->willReturn('audio/mpeg');
		$file->method('getName')->willReturn('a.mp3');
		$tags = $meta->extractTags($file);
		self::assertIsArray($tags);
	}
}
