<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Listener;

use OCA\AudioCheck\Listener\NodeEventListener;
use OCA\AudioCheck\Service\ScanService;
use OCP\EventDispatcher\Event;
use OCP\Files\Events\Node\NodeCopiedEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeRenamedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Files\File;
use OCP\Files\Node;
use OCP\IUser;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * AC-TST-NODE-01: AbstractNodesEvent must use getSource/getTarget — never getNode().
 * Listener failures must never escape (DAV MOVE/COPY must not abort).
 */
final class NodeEventListenerTest extends TestCase
{
	private ScanService&MockObject $scan;
	private LoggerInterface&MockObject $logger;
	private NodeEventListener $listener;

	protected function setUp(): void
	{
		$this->scan = $this->createMock(ScanService::class);
		$this->logger = $this->createMock(LoggerInterface::class);
		$this->listener = new NodeEventListener($this->scan, $this->logger);
	}

	public function testRenamedUsesHandleRenameNotGetNode(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn('alice');
		$target->method('getOwner')->willReturn($owner);

		$this->scan->expects($this->once())
			->method('handleRename')
			->with('alice', $source, $target);
		$this->scan->expects($this->never())->method('handleNodeEvent');
		$this->scan->expects($this->never())->method('handleCopy');

		$this->listener->handle(new NodeRenamedEvent($source, $target));
	}

	public function testCopiedUsesHandleCopyNotGetNode(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn('alice');
		$target->method('getOwner')->willReturn($owner);

		$this->scan->expects($this->once())
			->method('handleCopy')
			->with('alice', $source, $target);
		$this->scan->expects($this->never())->method('handleRename');
		$this->scan->expects($this->never())->method('handleNodeEvent');

		$this->listener->handle(new NodeCopiedEvent($source, $target));
	}

	public function testRenamedFallsBackToSourceOwnerWhenTargetOwnerMissing(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn('bob');
		$target->method('getOwner')->willReturn(null);
		$source->method('getOwner')->willReturn($owner);

		$this->scan->expects($this->once())
			->method('handleRename')
			->with('bob', $source, $target);

		$this->listener->handle(new NodeRenamedEvent($source, $target));
	}

	public function testRenamedIgnoresWhenNoOwner(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$target->method('getOwner')->willReturn(null);
		$source->method('getOwner')->willReturn(null);

		$this->scan->expects($this->never())->method('handleRename');
		$this->scan->expects($this->never())->method('handleCopy');
		$this->scan->expects($this->never())->method('handleNodeEvent');

		$this->listener->handle(new NodeRenamedEvent($source, $target));
	}

	public function testRenamedSurvivesTargetOwnerThrowing(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn('carol');
		$target->method('getOwner')->willThrowException(new \RuntimeException('gone'));
		$source->method('getOwner')->willReturn($owner);

		$this->scan->expects($this->once())
			->method('handleRename')
			->with('carol', $source, $target);

		$this->listener->handle(new NodeRenamedEvent($source, $target));
	}

	public function testCreatedWrittenDeletedDelegateToHandleNodeEvent(): void
	{
		$file = $this->ownedFile('dave', 42);

		$this->scan->expects($this->exactly(3))
			->method('handleNodeEvent')
			->withConsecutive(
				['dave', $file, 'written'],
				['dave', $file, 'written'],
				['dave', $file, 'deleted'],
			);

		$this->listener->handle(new NodeCreatedEvent($file));
		$this->listener->handle(new NodeWrittenEvent($file));
		$this->listener->handle(new NodeDeletedEvent($file));
	}

	public function testUnknownEventIsIgnored(): void
	{
		$this->scan->expects($this->never())->method('handleNodeEvent');
		$this->scan->expects($this->never())->method('handleRename');
		$this->scan->expects($this->never())->method('handleCopy');
		$this->listener->handle(new Event());
	}

	public function testListenerSwallowsScanExceptionsAndLogs(): void
	{
		$source = $this->createMock(Node::class);
		$target = $this->createMock(File::class);
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn('eve');
		$target->method('getOwner')->willReturn($owner);

		$this->scan->method('handleRename')->willThrowException(new \RuntimeException('boom'));
		$this->logger->expects($this->once())
			->method('error')
			->with(
				'AudioCheck node listener failed',
				$this->callback(static fn (array $ctx): bool => isset($ctx['exception']) && $ctx['exception'] instanceof \Throwable),
			);

		// Must not throw — would abort DAV MOVE.
		$this->listener->handle(new NodeRenamedEvent($source, $target));
		$this->addToAssertionCount(1);
	}

	public function testSourceDoesNotCallGetNodeOnAbstractNodesEvents(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Listener/NodeEventListener.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('getSource()', $source);
		$this->assertStringContainsString('getTarget()', $source);
		$this->assertStringContainsString('handleRename', $source);
		$this->assertStringContainsString('handleCopy', $source);
		$this->assertStringContainsString('NodeCopiedEvent', $source);
		$this->assertStringNotContainsString(
			'NodeRenamedEvent => $event->getNode()',
			$source,
		);
		$this->assertStringNotContainsString(
			'NodeCopiedEvent => $event->getNode()',
			$source,
		);
		$this->assertDoesNotMatchRegularExpression(
			'/instanceof\s+NodeRenamedEvent\s*=>\s*\$event->getNode\s*\(/',
			$source,
		);
		$this->assertDoesNotMatchRegularExpression(
			'/instanceof\s+NodeCopiedEvent\s*=>\s*\$event->getNode\s*\(/',
			$source,
		);
	}

	public function testApplicationRegistersCopiedEvent(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/AppInfo/Application.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('NodeCopiedEvent::class, NodeEventListener::class', $source);
	}

	private function ownedFile(string $uid, int $id): File&MockObject
	{
		$owner = $this->createMock(IUser::class);
		$owner->method('getUID')->willReturn($uid);
		$file = $this->createMock(File::class);
		$file->method('getOwner')->willReturn($owner);
		$file->method('getId')->willReturn($id);
		return $file;
	}
}
