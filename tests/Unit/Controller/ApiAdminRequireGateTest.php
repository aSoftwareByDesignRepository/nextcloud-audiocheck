<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Controller\ApiController;
use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\LibraryService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCA\AudioCheck\Service\PlayQueueService;
use OCA\AudioCheck\Service\PlaylistService;
use OCA\AudioCheck\Service\RateLimitService;
use OCA\AudioCheck\Service\ScanService;
use OCA\AudioCheck\Service\UserPrefsService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/** INV-AUTH-4: non-app-admin must get 403 on every /api/admin/* action. */
final class ApiAdminRequireGateTest extends TestCase
{
	private function controllerDenyAdmin(): ApiController
	{
		$request = $this->createMock(IRequest::class);
		$request->method('getParam')->willReturn('');
		$request->method('getParams')->willReturn([]);

		$access = $this->createMock(AccessControlService::class);
		$access->method('currentUserId')->willReturn('bob');
		$access->method('requireAppAdmin')->willThrowException(new AccessDeniedException());

		return new ApiController(
			'audiocheck',
			$request,
			$access,
			$this->createMock(LibraryService::class),
			$this->createMock(ScanService::class),
			$this->createMock(PlaybackStateService::class),
			$this->createMock(PlayQueueService::class),
			$this->createMock(PlaylistService::class),
			$this->createMock(UserPrefsService::class),
			$this->createMock(RateLimitService::class),
			$this->createMock(LoggerInterface::class),
		);
	}

	/** @return list<array{0:string,1:callable(ApiController):JSONResponse}> */
	public static function adminActions(): array
	{
		return [
			['getAppPolicy', static fn (ApiController $c): JSONResponse => $c->getAppPolicy()],
			['saveAppPolicy', static fn (ApiController $c): JSONResponse => $c->saveAppPolicy()],
			['searchUsers', static fn (ApiController $c): JSONResponse => $c->searchUsers()],
			['searchGroups', static fn (ApiController $c): JSONResponse => $c->searchGroups()],
		];
	}

	/** @dataProvider adminActions */
	public function testNonAppAdminGets403(string $label, callable $invoke): void
	{
		$response = $invoke($this->controllerDenyAdmin());
		self::assertInstanceOf(JSONResponse::class, $response, $label);
		self::assertSame(Http::STATUS_FORBIDDEN, $response->getStatus(), $label);
		$data = $response->getData();
		self::assertFalse($data['ok'] ?? true, $label);
		self::assertSame('access_denied', $data['error']['code'] ?? null, $label);
	}
}
