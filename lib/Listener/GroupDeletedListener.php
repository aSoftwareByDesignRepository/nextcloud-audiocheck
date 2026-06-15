<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\Service\AccessControlService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\GroupDeletedEvent;

/** @template-implements IEventListener<Event> */
class GroupDeletedListener implements IEventListener
{
	public function __construct(
		private AccessControlService $access,
	) {
	}

	public function handle(Event $event): void
	{
		if (!$event instanceof GroupDeletedEvent) {
			return;
		}
		$this->access->purgeGroup($event->getGroup()->getGID());
	}
}
