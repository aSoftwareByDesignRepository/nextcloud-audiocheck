<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class AccessControlServiceTest extends TestCase
{
	public function testCanUseAppWhenRestrictionDisabled(): void
	{
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturnCallback(function (string $app, string $key, string $default) {
			if ($key === AccessControlService::KEY_ACCESS_RESTRICTION) {
				return '0';
			}
			return $default;
		});
		$svc = new AccessControlService(
			$config,
			$this->createMock(IGroupManager::class),
			$this->createMock(IUserSession::class),
			$this->createMock(IUserManager::class),
			$this->createMock(LoggerInterface::class),
		);
		$this->assertTrue($svc->canUseApp('alice'));
	}

	public function testCanUseAppDeniedWhenRestrictionEnabledAndNotOnList(): void
	{
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturnCallback(function (string $app, string $key, string $default) {
			return match ($key) {
				AccessControlService::KEY_ACCESS_RESTRICTION => '1',
				AccessControlService::KEY_APP_ADMINS => '[]',
				AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS => '[]',
				AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS => '[]',
				default => $default,
			};
		});
		$groups = $this->createMock(IGroupManager::class);
		$groups->method('isAdmin')->willReturn(false);
		$svc = new AccessControlService(
			$config,
			$groups,
			$this->createMock(IUserSession::class),
			$this->createMock(IUserManager::class),
			$this->createMock(LoggerInterface::class),
		);
		$this->assertFalse($svc->canUseApp('bob'));
	}
}
