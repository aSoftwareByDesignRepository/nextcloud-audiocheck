<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\ScanService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;

/** @template-implements IEventListener<Event> */
class UserDeletedListener implements IEventListener
{
	public function __construct(
		private AccessControlService $access,
		private ScanService $scan,
		private PlayQueueService $queue,
	) {
	}

	public function handle(Event $event): void
	{
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$uid = $event->getUser()->getUID();
		$this->access->purgeUser($uid);
		$this->scan->purgeUserData($uid);
		$this->queue->purgeUser($uid);
	}
}
