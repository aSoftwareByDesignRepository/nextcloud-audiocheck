<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Controller\ApiController;
use OCA\AudioCheck\Exception\AppAccessDeniedException;
use OCA\AudioCheck\Middleware\AppAccessMiddleware;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Tests\Shim\IntegrationTestUsers;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserManager;
use OCP\IUserSession;
use Test\TestCase;

/** AC-TST-11: app-use gate returns 403 when restriction denies the user. */
final class AppAccessGateIntegrationTest extends TestCase
{
	private const ALLOWED = 'ac_gate_allowed';
	private const DENIED = 'ac_gate_denied';
	private const PASSWORD = 'ac-test-pass-9xK!';

	private ?string $prevRestriction = null;
	private ?string $prevAllowedUsers = null;
	private ?string $prevAllowedGroups = null;

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		$this->prevRestriction = $config->getAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_RESTRICTION, '0');
		$this->prevAllowedUsers = $config->getAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS, '[]');
		$this->prevAllowedGroups = $config->getAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS, '[]');

		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::ALLOWED, self::DENIED] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	protected function tearDown(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		if ($this->prevRestriction !== null) {
			$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_RESTRICTION, $this->prevRestriction);
		}
		if ($this->prevAllowedUsers !== null) {
			$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS, $this->prevAllowedUsers);
		}
		if ($this->prevAllowedGroups !== null) {
			$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS, $this->prevAllowedGroups);
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::ALLOWED, self::DENIED] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
		IntegrationTestUsers::clearSession();
	}

	public function testDeniedUserBlockedByMiddleware(): void
	{
		IntegrationTestUsers::create(self::ALLOWED, self::PASSWORD);
		IntegrationTestUsers::create(self::DENIED, self::PASSWORD);

		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_RESTRICTION, '1');
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS, json_encode([self::ALLOWED], JSON_THROW_ON_ERROR));
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS, '[]');

		IntegrationTestUsers::loginAs(self::DENIED);

		/** @var ApiController $controller */
		$controller = \OC::$server->get(ApiController::class);
		$middleware = $this->middlewareWithMockRequest();

		try {
			$middleware->beforeController($controller, 'listTracks');
			$this->fail('Expected AppAccessDeniedException for gated user');
		} catch (AppAccessDeniedException) {
			$this->addToAssertionCount(1);
		}

		$response = $middleware->afterException($controller, 'listTracks', new AppAccessDeniedException());
		$this->assertInstanceOf(JSONResponse::class, $response);
		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$data = $response->getData();
		$this->assertIsArray($data);
		$this->assertSame('access_denied', $data['error']['code'] ?? null);
	}

	public function testAllowedUserPassesGate(): void
	{
		IntegrationTestUsers::create(self::ALLOWED, self::PASSWORD);

		/** @var IConfig $config */
		$config = \OC::$server->get(IConfig::class);
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_RESTRICTION, '1');
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS, json_encode([self::ALLOWED], JSON_THROW_ON_ERROR));
		$config->setAppValue(Application::APP_ID, AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS, '[]');

		IntegrationTestUsers::loginAs(self::ALLOWED);

		/** @var ApiController $controller */
		$controller = \OC::$server->get(ApiController::class);
		$this->middlewareWithMockRequest()->beforeController($controller, 'listTracks');
		$this->addToAssertionCount(1);
	}

	private function middlewareWithMockRequest(): AppAccessMiddleware
	{
		$request = $this->createMock(IRequest::class);
		$request->method('getPathInfo')->willReturn('/apps/audiocheck/api/tracks');
		$request->method('getMethod')->willReturn('GET');
		$request->method('getHeader')->willReturnCallback(
			static fn (string $name): string => match (strtolower($name)) {
				'accept' => 'application/json',
				default => '',
			},
		);

		return new AppAccessMiddleware(
			\OC::$server->get(IUserSession::class),
			\OC::$server->get(AccessControlService::class),
			$request,
			\OC::$server->get(\OCP\IURLGenerator::class),
			\OC::$server->get(\OCP\L10N\IFactory::class),
			\OC::$server->get(\Psr\Log\LoggerInterface::class),
		);
	}
}
