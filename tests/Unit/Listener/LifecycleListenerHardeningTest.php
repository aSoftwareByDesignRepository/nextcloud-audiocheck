<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Listener;

use OCA\AudioCheck\Listener\GroupDeletedListener;
use OCA\AudioCheck\Listener\UserDeletedListener;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\ScanService;
use OCP\EventDispatcher\Event;
use OCP\Group\Events\GroupDeletedEvent;
use OCP\IGroup;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * AC-TST-NODE-04: delete listeners must not throw into the core event bus.
 */
final class LifecycleListenerHardeningTest extends TestCase
{
	public function testUserDeletedSwallowsCleanupFailures(): void
	{
		$access = $this->createMock(AccessControlService::class);
		$access->method('purgeUser')->willThrowException(new \RuntimeException('db down'));
		$scan = $this->createMock(ScanService::class);
		$queue = $this->createMock(PlayQueueService::class);
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('error');

		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('gone');

		$listener = new UserDeletedListener($access, $scan, $queue, $logger);
		$listener->handle(new UserDeletedEvent($user));
		$this->addToAssertionCount(1);
	}

	public function testGroupDeletedSwallowsCleanupFailures(): void
	{
		$access = $this->createMock(AccessControlService::class);
		$access->method('purgeGroup')->willThrowException(new \RuntimeException('db down'));
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())->method('error');

		$group = $this->createMock(IGroup::class);
		$group->method('getGID')->willReturn('team');

		$listener = new GroupDeletedListener($access, $logger);
		$listener->handle(new GroupDeletedEvent($group));
		$this->addToAssertionCount(1);
	}

	public function testUserDeletedIgnoresForeignEvents(): void
	{
		$access = $this->createMock(AccessControlService::class);
		$access->expects($this->never())->method('purgeUser');
		$listener = new UserDeletedListener(
			$access,
			$this->createMock(ScanService::class),
			$this->createMock(PlayQueueService::class),
			$this->createMock(LoggerInterface::class),
		);
		$listener->handle(new Event());
	}
}
