<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Controller\StreamController;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\FileAccessService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\StreamResponseFactory;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

/** Stream play must bound opens and map RateLimitExceededException → 429 (not 404). */
final class StreamControllerRateLimitTest extends TestCase
{
	public function testPlayReturns429WhenRateLimitedAndDoesNotResolveFile(): void
	{
		$request = $this->createMock(IRequest::class);
		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willReturn('alice');

		$rate = $this->createMock(RateLimitService::class);
		$rate->expects($this->once())
			->method('assertAllowed')
			->with(
				'alice',
				'stream',
				StreamController::STREAM_RATE_MAX,
				StreamController::STREAM_RATE_WINDOW_SEC,
			)
			->willThrowException(new RateLimitExceededException());

		$fileAccess = $this->createMock(FileAccessService::class);
		$fileAccess->expects($this->never())->method('resolveReadableFile');

		$factory = $this->createMock(StreamResponseFactory::class);
		$factory->expects($this->never())->method('createFromFile');

		$controller = new StreamController(
			'audiocheck',
			$request,
			$access,
			$fileAccess,
			$factory,
			$rate,
		);

		$response = $controller->play(42);
		self::assertInstanceOf(JSONResponse::class, $response);
		self::assertSame(Http::STATUS_TOO_MANY_REQUESTS, $response->getStatus());
		$data = $response->getData();
		self::assertFalse($data['ok'] ?? true);
		self::assertSame('rate_limit_exceeded', $data['error']['code'] ?? null);
	}

	public function testStreamBudgetIsDocumentedAndAboveCover(): void
	{
		// Cover is 120/60; stream must stay higher for Range seeking but still finite.
		self::assertSame(300, StreamController::STREAM_RATE_MAX);
		self::assertSame(60, StreamController::STREAM_RATE_WINDOW_SEC);
		self::assertGreaterThan(120, StreamController::STREAM_RATE_MAX);
	}

	public function testControllerWiresRateLimitBeforeResolve(): void
	{
		$src = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Controller/StreamController.php');
		self::assertMatchesRegularExpression(
			"/assertAllowed\s*\(\s*\\\$userId\s*,\s*'stream'/m",
			$src,
		);
		self::assertMatchesRegularExpression(
			'/assertAllowed\s*\([\s\S]*?\)\s*;[\s\S]*?resolveReadableFile/m',
			$src,
		);
		self::assertStringContainsString('RateLimitExceededException', $src);
		self::assertStringContainsString('STATUS_TOO_MANY_REQUESTS', $src);
	}
}
