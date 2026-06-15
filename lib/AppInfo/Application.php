<?php

declare(strict_types=1);

namespace OCA\AudioCheck\AppInfo;

use OCA\AudioCheck\BackgroundJob\ScanJob;
use OCA\AudioCheck\Command\Scan as ScanCommand;
use OCA\AudioCheck\Dashboard\ContinueWidget;
use OCA\AudioCheck\Listener\GroupDeletedListener;
use OCA\AudioCheck\Listener\NodeEventListener;
use OCA\AudioCheck\Listener\UserDeletedListener;
use OCA\AudioCheck\Middleware\AppAccessMiddleware;
use OCA\AudioCheck\Repair\EnsureAudioCheckSchema;
use OCA\AudioCheck\Repair\UninstallDropTables;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\MetadataService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCA\AudioCheck\Service\UserPrefsService;
use OCA\AudioCheck\Settings\AdminSettings;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\INavigationManager;
use OCP\L10N\IFactory;
use OCP\User\Events\UserDeletedEvent;
use OCP\Util;

class Application extends App implements IBootstrap
{
	public const APP_ID = 'audiocheck';

	public function __construct()
	{
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void
	{
		$context->registerService(AccessControlService::class, function ($c): AccessControlService {
			return new AccessControlService(
				$c->query(\OCP\IConfig::class),
				$c->query(\OCP\IGroupManager::class),
				$c->query(\OCP\IUserSession::class),
				$c->query(\OCP\IUserManager::class),
				$c->query(\Psr\Log\LoggerInterface::class),
			);
		});

		$context->registerService(AppAccessMiddleware::class, function ($c): AppAccessMiddleware {
			return new AppAccessMiddleware(
				$c->query(\OCP\IUserSession::class),
				$c->query(AccessControlService::class),
				$c->query(\OCP\IRequest::class),
				$c->query(\OCP\IURLGenerator::class),
				$c->query(IFactory::class),
				$c->query(\Psr\Log\LoggerInterface::class),
			);
		});
		$context->registerMiddleware(AppAccessMiddleware::class);

		$context->registerService(RateLimitService::class, fn ($c) => new RateLimitService($c->query(\OCP\IConfig::class)));

		$context->registerService(FileAccessService::class, function ($c): FileAccessService {
			return new FileAccessService(
				$c->query(\OCP\Files\IRootFolder::class),
				$c->query(\OCP\Encryption\IManager::class),
				$c->query(\OCP\IConfig::class),
			);
		});

		$context->registerService(StreamResponseFactory::class, fn ($c) => new StreamResponseFactory($c->query(FileAccessService::class)));

		$context->registerService(MetadataService::class, function ($c): MetadataService {
			return new MetadataService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(FileAccessService::class),
				$c->query(AccessControlService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
				$c->query(\Psr\Log\LoggerInterface::class),
			);
		});

		$context->registerService(CoverService::class, function ($c): CoverService {
			return new CoverService(
				$c->query(\OCP\Files\IAppData::class),
				$c->query(FileAccessService::class),
				$c->query(MetadataService::class),
				$c->query(\OCP\IDBConnection::class),
				$c->query(\Psr\Log\LoggerInterface::class),
			);
		});

		$context->registerService(ScanService::class, function ($c): ScanService {
			return new ScanService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(FileAccessService::class),
				$c->query(MetadataService::class),
				$c->query(CoverService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
				$c->query(\OCP\BackgroundJob\IJobList::class),
				$c->query(\OCP\IConfig::class),
				$c->query(\Psr\Log\LoggerInterface::class),
			);
		});

		$context->registerService(LibraryService::class, function ($c): LibraryService {
			return new LibraryService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(FileAccessService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
				$c->query(\OCP\ITagManager::class),
				$c->query(\OCP\SystemTag\ISystemTagManager::class),
				$c->query(\OCP\SystemTag\ISystemTagObjectMapper::class),
			);
		});

		$context->registerService(PlaybackStateService::class, function ($c): PlaybackStateService {
			return new PlaybackStateService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(FileAccessService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
				$c->query(\OCP\IConfig::class),
			);
		});

		$context->registerService(PlayQueueService::class, function ($c): PlayQueueService {
			return new PlayQueueService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(LibraryService::class),
				$c->query(PlaybackStateService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
			);
		});

		$context->registerService(PlaylistService::class, function ($c): PlaylistService {
			return new PlaylistService(
				$c->query(\OCP\IDBConnection::class),
				$c->query(FileAccessService::class),
				$c->query(LibraryService::class),
				$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
			);
		});

		$context->registerService(UserPrefsService::class, fn ($c) => new UserPrefsService(
			$c->query(\OCP\IConfig::class),
			$c->query(PlaybackStateService::class),
		));

		$context->registerService(EnsureAudioCheckSchema::class, function ($c): EnsureAudioCheckSchema {
			return new EnsureAudioCheckSchema(
				$c->query(\OCP\IDBConnection::class),
				$c->query(\OCP\IConfig::class),
				$c->query(\OCP\BackgroundJob\IJobList::class),
			);
		});

		$context->registerService(UninstallDropTables::class, function ($c): UninstallDropTables {
			return new UninstallDropTables(
				$c->query(\OCP\IDBConnection::class),
				$c->query(\OCP\IConfig::class),
				$c->query(CoverService::class),
			);
		});

		$context->registerService(ContinueWidget::class, function ($c): ContinueWidget {
			return new ContinueWidget(
				$c->query(\OCP\IL10N::class),
				$c->query(\OCP\IURLGenerator::class),
				$c->query(PlaybackStateService::class),
				$c->query(AccessControlService::class),
				$c->query(\OCP\IUserSession::class),
			);
		});

		$context->registerDashboardWidget(ContinueWidget::class);

		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
		$context->registerEventListener(GroupDeletedEvent::class, GroupDeletedListener::class);
		$context->registerEventListener(NodeCreatedEvent::class, NodeEventListener::class);
		$context->registerEventListener(NodeWrittenEvent::class, NodeEventListener::class);
		$context->registerEventListener(NodeDeletedEvent::class, NodeEventListener::class);
		$context->registerEventListener(NodeRenamedEvent::class, NodeEventListener::class);

		$context->registerService(ScanCommand::class, fn ($c) => new ScanCommand(
			$c->query(ScanService::class),
			$c->query(\OCP\IUserManager::class),
		));

		$context->registerService(\OCA\AudioCheck\BackgroundJob\ScanSchedulerJob::class, fn ($c) => new \OCA\AudioCheck\BackgroundJob\ScanSchedulerJob(
			$c->query(\OCP\AppFramework\Utility\ITimeFactory::class),
			$c->query(ScanService::class),
		));
	}

	public function boot(IBootContext $context): void
	{
		$container = $context->getAppContainer();

		$access = $container->get(AccessControlService::class);
		$userSession = $container->get(\OCP\IUserSession::class);
		$user = $userSession->getUser();
		if ($user !== null && $access->canUseApp($user->getUID())) {
			$navigation = $container->get(INavigationManager::class);
			$navigation->add(function () use ($container) {
				$l = $container->get(IFactory::class)->get(self::APP_ID);
				$url = $container->get(\OCP\IURLGenerator::class);
				return [
					'id' => self::APP_ID,
					'order' => 12,
					'href' => $url->linkToRoute('audiocheck.page.index'),
					'icon' => $url->imagePath(self::APP_ID, 'app.svg'),
					'name' => $l->t('AudioCheck'),
				];
			});
			Util::addScript(self::APP_ID, 'files-action', 'files');
			Util::addScript(self::APP_ID, 'dashboard', 'dashboard');
		}
	}
}
