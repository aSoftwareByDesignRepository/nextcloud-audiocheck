<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\Service\ScanService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;

/** @template-implements IEventListener<Event> */
class NodeEventListener implements IEventListener
{
	public function __construct(
		private ScanService $scan,
	) {
	}

	public function handle(Event $event): void
	{
		$node = match (true) {
			$event instanceof NodeCreatedEvent => $event->getNode(),
			$event instanceof NodeWrittenEvent => $event->getNode(),
			$event instanceof NodeRenamedEvent => $event->getNode(),
			$event instanceof NodeDeletedEvent => $event->getNode(),
			default => null,
		};
		if ($node === null) {
			return;
		}
		$owner = $node->getOwner();
		if ($owner === null) {
			return;
		}
		$eventName = $event instanceof NodeDeletedEvent ? 'deleted' : 'written';
		$this->scan->handleNodeEvent($owner->getUID(), $node, $eventName);
	}
}
