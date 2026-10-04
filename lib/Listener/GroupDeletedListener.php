<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\Service\AccessControlService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\GroupDeletedEvent;
use Psr\Log\LoggerInterface;

/** @template-implements IEventListener<Event> */
class GroupDeletedListener implements IEventListener
{
	public function __construct(
		private AccessControlService $access,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void
	{
		if (!$event instanceof GroupDeletedEvent) {
			return;
		}
		try {
			$this->access->purgeGroup($event->getGroup()->getGID());
		} catch (\Throwable $e) {
			// best-effort: the group is already gone — cleanup failure must not
			// break the deletion event chain; the stale allow-list entry is inert.
			$this->logger->error('AudioCheck group-deleted cleanup failed', ['exception' => $e]);
		}
	}
}
