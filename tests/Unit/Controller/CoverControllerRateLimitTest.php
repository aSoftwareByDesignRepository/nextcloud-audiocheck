<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Controller\CoverController;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\CoverService;
use OCA\AudioCheck\Service\RateLimitService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

/** INV-DOS-1: cover extraction must bound opens and map RateLimitExceededException → 429. */
final class CoverControllerRateLimitTest extends TestCase
{
	public function testGetReturns429WhenRateLimitedAndDoesNotFetchCover(): void
	{
		$request = $this->createMock(IRequest::class);
		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willReturn('alice');

		$rate = $this->createMock(RateLimitService::class);
		$rate->expects($this->once())
			->method('assertAllowed')
			->with('alice', 'cover', 120, 60)
			->willThrowException(new RateLimitExceededException());

		$cover = $this->createMock(CoverService::class);
		$cover->expects($this->never())->method('getCoverResponse');

		$controller = new CoverController(
			'audiocheck',
			$request,
			$access,
			$cover,
			$rate,
		);

		$response = $controller->get(42);
		self::assertInstanceOf(JSONResponse::class, $response);
		self::assertSame(Http::STATUS_TOO_MANY_REQUESTS, $response->getStatus());
		$data = $response->getData();
		self::assertFalse($data['ok'] ?? true);
		self::assertSame('rate_limit_exceeded', $data['error']['code'] ?? null);
	}
}
