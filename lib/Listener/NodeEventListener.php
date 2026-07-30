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
use OCP\Files\Node;
use Psr\Log\LoggerInterface;

/**
 * Keeps the AudioCheck track index in sync with filesystem create/write/delete/rename.
 *
 * Critical: this listener must never throw. Uncaught exceptions from post-rename
 * listeners abort the DAV MOVE mid-flight (destination written, source not removed).
 *
 * @template-implements IEventListener<Event>
 */
class NodeEventListener implements IEventListener
{
	public function __construct(
		private ScanService $scan,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void
	{
		try {
			$this->dispatch($event);
		} catch (\Throwable $e) {
			// Never break Files/DAV operations because of indexing side effects.
			$this->logger->error('AudioCheck node listener failed', ['exception' => $e]);
		}
	}

	private function dispatch(Event $event): void
	{
		if ($event instanceof NodeRenamedEvent) {
			$this->handleRenamed($event);
			return;
		}

		$node = match (true) {
			$event instanceof NodeCreatedEvent => $event->getNode(),
			$event instanceof NodeWrittenEvent => $event->getNode(),
			$event instanceof NodeDeletedEvent => $event->getNode(),
			default => null,
		};
		if ($node === null) {
			return;
		}

		$userId = $this->ownerUid($node);
		if ($userId === null) {
			return;
		}

		$eventName = $event instanceof NodeDeletedEvent ? 'deleted' : 'written';
		$this->scan->handleNodeEvent($userId, $node, $eventName);
	}

	/**
	 * NodeRenamedEvent extends AbstractNodesEvent (getSource/getTarget), not
	 * AbstractNodeEvent (getNode). Calling getNode() fatals on every rename/move.
	 */
	private function handleRenamed(NodeRenamedEvent $event): void
	{
		$source = $event->getSource();
		$target = $event->getTarget();

		// Prefer the post-rename target: the source path is typically a NonExisting*
		// node whose getOwner()/getId() throw NotFoundException.
		$userId = $this->ownerUid($target) ?? $this->ownerUid($source);
		if ($userId === null) {
			return;
		}

		$this->scan->handleRename($userId, $source, $target);
	}

	private function ownerUid(Node $node): ?string
	{
		try {
			$owner = $node->getOwner();
		} catch (\Throwable) {
			return null;
		}
		if ($owner === null) {
			return null;
		}
		$uid = $owner->getUID();
		return $uid !== '' ? $uid : null;
	}
}
