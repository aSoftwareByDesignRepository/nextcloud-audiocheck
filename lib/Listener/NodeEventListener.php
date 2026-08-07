<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Listener;

use OCA\AudioCheck\Service\ScanService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCopiedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Files\Node;
use Psr\Log\LoggerInterface;

/**
 * Keeps the AudioCheck track index in sync with filesystem create/write/delete/rename/copy.
 *
 * Critical: this listener must never throw. Uncaught exceptions from post-rename/copy
 * listeners abort DAV MOVE/COPY mid-flight (destination written, source not removed).
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
			$this->handleNodesEvent($event->getSource(), $event->getTarget(), 'rename');
			return;
		}
		if ($event instanceof NodeCopiedEvent) {
			$this->handleNodesEvent($event->getSource(), $event->getTarget(), 'copy');
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
	 * NodeRenamedEvent / NodeCopiedEvent extend AbstractNodesEvent (getSource/getTarget),
	 * not AbstractNodeEvent (getNode). Calling getNode() fatals on every rename/move/copy.
	 *
	 * @param 'rename'|'copy' $op
	 */
	private function handleNodesEvent(Node $source, Node $target, string $op): void
	{
		// Prefer the destination: source may be NonExisting* after rename (getOwner/getId throw).
		$userId = $this->ownerUid($target) ?? $this->ownerUid($source);
		if ($userId === null) {
			return;
		}

		if ($op === 'copy') {
			$this->scan->handleCopy($userId, $source, $target);
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
