<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Command\Scan;
use OCA\AudioCheck\Command\UpgradeBackupCommand;
use OCA\AudioCheck\Controller\CoverController;
use OCA\AudioCheck\Controller\PageController;
use OCA\AudioCheck\Controller\StreamController;
use OCA\AudioCheck\Dashboard\ContinueWidget;
use OCA\AudioCheck\Exception\AppAccessDeniedException;
use OCA\AudioCheck\Middleware\AppAccessMiddleware;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\AppIconService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\SettingsSectionCatalog;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCA\AudioCheck\Support\MobileAppLinks;
use OCP\App\IAppManager;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Dashboard\Model\WidgetItems;
use OCP\Files\File;
use OCP\IConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use ReflectionClass;
use Symfony\Component\Console\Tester\CommandTester;

/**
 * Invoke proofs for page/cover/stream controllers, middleware, dashboard, and CLI entrypoints.
 */
final class EntrypointInvokeCoverageTest extends TestCase
{
	public function testEveryPageControllerActionIsInvoked(): void
	{
		$request = $this->createMock(IRequest::class);
		$request->method('getParam')->willReturn(null);
		$url = $this->createMock(IURLGenerator::class);
		$url->method('linkToRoute')->willReturnCallback(static fn (string $r, array $p = []): string => '/apps/audiocheck/' . $r);
		$url->method('imagePath')->willReturn('/apps/audiocheck/img/app.svg');
		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willReturn('alice');
		$access->method('isAppAdmin')->willReturn(true);
		$access->method('requireAppAdmin')->willReturn('alice');
		$l10n = $this->createMock(IL10N::class);
		$l10n->method('t')->willReturnCallback(static fn (string $s, array $a = []): string => $s);
		$l10n->method('getLanguageCode')->willReturn('en');
		$l10n->method('getLocaleCode')->willReturn('en_US');
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('UTC');
		$config->method('getSystemValueString')->willReturn('UTC');
		$sections = new SettingsSectionCatalog();
		$mobile = new MobileAppLinks();

		$controller = new PageController(
			'audiocheck',
			$request,
			$url,
			$access,
			$l10n,
			$config,
			$sections,
			$mobile,
		);

		$invoked = [];
		foreach ([
			'index', 'audiobooks', 'music', 'playlists', 'favoritesPlaylist', 'playlist',
			'browse', 'nowPlaying', 'library', 'settings', 'getTheApp',
		] as $method) {
			$res = $controller->$method(...($method === 'playlist' ? [7] : []));
			self::assertInstanceOf(TemplateResponse::class, $res, $method);
			$invoked[] = $method;
		}

		$redirect = $controller->appSettingsIndex();
		self::assertInstanceOf(RedirectResponse::class, $redirect);
		$invoked[] = 'appSettingsIndex';

		$settings = $controller->appSettings(SettingsSectionCatalog::DEFAULT_SECTION);
		self::assertInstanceOf(TemplateResponse::class, $settings);
		$invoked[] = 'appSettings';

		$ref = new ReflectionClass(PageController::class);
		$public = [];
		foreach ($ref->getMethods(\ReflectionMethod::IS_PUBLIC) as $m) {
			if ($m->getDeclaringClass()->getName() !== PageController::class || $m->getName() === '__construct') {
				continue;
			}
			$public[] = $m->getName();
		}
		sort($public);
		sort($invoked);
		self::assertSame($public, $invoked);
	}

	public function testCoverAndStreamControllersAreInvoked(): void
	{
		$request = $this->createMock(IRequest::class);
		$request->method('getHeader')->willReturn('');
		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willReturn('alice');
		$rate = $this->createMock(RateLimitService::class);
		$rate->method('assertAllowed')->willReturnCallback(static function (): void {});

		$coverSvc = $this->createMock(CoverService::class);
		$coverPayload = new DataDisplayResponse('img', Http::STATUS_OK, ['Content-Type' => 'image/jpeg']);
		$coverSvc->expects($this->once())->method('getCoverResponse')->with('alice', 42)->willReturn($coverPayload);
		$cover = new CoverController('audiocheck', $request, $access, $coverSvc, $rate);
		self::assertSame($coverPayload, $cover->get(42));

		$file = $this->createMock(File::class);
		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->expects($this->once())->method('resolveReadableFile')->with('alice', 42)->willReturn($file);
		$factory = $this->createMock(StreamResponseFactory::class);
		$streamPayload = $this->getMockBuilder(\OCA\AudioCheck\Service\RangeStreamResponse::class)
			->disableOriginalConstructor()
			->getMock();
		$factory->expects($this->once())->method('createFromFile')->willReturn($streamPayload);
		$stream = new StreamController('audiocheck', $request, $access, $fileAccess, $factory, $rate);
		self::assertSame($streamPayload, $stream->play(42));
	}

	public function testAppAccessMiddlewareBeforeAndAfterAreInvoked(): void
	{
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('bob');
		$session = $this->createMock(IUserSession::class);
		$session->method('getUser')->willReturn($user);
		$access = $this->createMock(AccessControlService::class);
		$access->method('canUseApp')->with('bob')->willReturn(false);
		$access->method('denialReasonWhenCannotUseApp')->willReturn(AccessControlService::DENIAL_RESTRICTION);
		$request = $this->createMock(IRequest::class);
		$request->method('getPathInfo')->willReturn('/apps/audiocheck/api/tracks');
		$request->method('getMethod')->willReturn('GET');
		$request->method('getHeader')->willReturn('application/json');
		$url = $this->createMock(IURLGenerator::class);
		$l10nFactory = $this->createMock(IFactory::class);
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('warning');

		$mw = new AppAccessMiddleware($session, $access, $request, $url, $l10nFactory, $logger);
		$controller = new CoverController(
			'audiocheck',
			$request,
			$access,
			$this->createMock(CoverService::class),
			$this->createMock(RateLimitService::class),
		);

		try {
			$mw->beforeController($controller, 'get');
			self::fail('expected AppAccessDeniedException');
		} catch (AppAccessDeniedException $e) {
			$res = $mw->afterException($controller, 'get', $e);
			self::assertInstanceOf(JSONResponse::class, $res);
			self::assertSame(Http::STATUS_FORBIDDEN, $res->getStatus());
		}
	}

	public function testContinueWidgetPublicSurfaceIsInvoked(): void
	{
		$access = $this->createMock(AccessControlService::class);
		$access->method('canUseApp')->willReturn(true);
		$playback = $this->createMock(PlaybackStateService::class);
		$playback->method('getContinueListening')->willReturn([
			['fileId' => 1, 'title' => 'T', 'artist' => 'A'],
		]);
		$session = $this->createMock(IUserSession::class);
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$session->method('getUser')->willReturn($user);
		$url = $this->createMock(IURLGenerator::class);
		$url->method('imagePath')->willReturn('/apps/audiocheck/img/app-dashboard.svg');
		$url->method('getAbsoluteURL')->willReturnCallback(static fn (string $p): string => 'https://nc.test' . $p);
		$url->method('linkToRouteAbsolute')->willReturn('https://nc.test/apps/audiocheck/');
		$l10n = $this->createMock(IL10N::class);
		$l10n->method('t')->willReturnCallback(static fn (string $s, array $a = []): string => $s);
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppVersion')->willReturn('1.3.7');
		$icons = new AppIconService($url, $apps);
		$widget = new ContinueWidget($l10n, $url, $playback, $access, $session, $icons);

		self::assertNotSame('', $widget->getId());
		self::assertNotSame('', $widget->getTitle());
		self::assertIsInt($widget->getOrder());
		self::assertNotSame('', $widget->getIconClass());
		self::assertStringContainsString('app-dashboard.svg', $widget->getIconUrl());
		self::assertNotNull($widget->getUrl());
		self::assertIsInt($widget->getReloadInterval());
		self::assertTrue($widget->isEnabled());
		$widget->load();
		self::assertNotEmpty($widget->getItems('alice'));
		$itemsV2 = $widget->getItemsV2('alice');
		self::assertInstanceOf(WidgetItems::class, $itemsV2);
		self::assertNotEmpty($widget->getWidgetButtons('alice'));
	}

	public function testScanCommandConfigureAndExecuteAreInvoked(): void
	{
		$scan = $this->createMock(ScanService::class);
		$scan->expects($this->once())->method('scanUser')->with('alice');
		$users = $this->createMock(IUserManager::class);
		$user = $this->createMock(IUser::class);
		$users->method('get')->with('alice')->willReturn($user);
		$cmd = new Scan($scan, $users);
		$tester = new CommandTester($cmd);
		self::assertSame(0, $tester->execute(['--user' => 'alice']));
	}

	public function testUpgradeBackupCommandIsInvoked(): void
	{
		if (!class_exists(UpgradeBackupCommand::class)) {
			self::markTestSkipped('UpgradeBackupCommand missing');
		}
		$ref = new ReflectionClass(UpgradeBackupCommand::class);
		self::assertTrue($ref->hasMethod('configure'));
		self::assertTrue($ref->hasMethod('execute'));
		// Prefer real execute when constructor is mockable; otherwise configure via CommandTester listing.
		$ctor = $ref->getConstructor();
		if ($ctor === null) {
			self::fail('UpgradeBackupCommand has no constructor');
		}
		$params = $ctor->getParameters();
		$args = [];
		foreach ($params as $param) {
			$type = $param->getType();
			$name = $type && !$type->isBuiltin() ? $type->getName() : null;
			$args[] = $name ? $this->createMock($name) : null;
		}
		/** @var UpgradeBackupCommand $cmd */
		$cmd = $ref->newInstanceArgs($args);
		$tester = new CommandTester($cmd);
		// --help exercises configure(); exit 0
		self::assertSame(0, $tester->execute(['--help'], ['capture_stderr_separately' => true]));
	}
}
