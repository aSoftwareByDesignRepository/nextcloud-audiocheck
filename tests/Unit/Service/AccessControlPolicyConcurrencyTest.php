<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\ConflictException;
use OCA\AudioCheck\Service\AccessControlService;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Section-scoped policy saves + optimistic concurrency — mutation-sensitive.
 */
final class AccessControlPolicyConcurrencyTest extends TestCase
{
	/** @var array<string, string> */
	private array $store = [];

	private function makeService(?string $sessionUid = 'admin'): AccessControlService
	{
		$config = $this->createMock(IConfig::class);
		$config->method('getAppValue')->willReturnCallback(function (string $app, string $key, ?string $default = '') {
			return $this->store[$key] ?? ($default ?? '');
		});
		$config->method('setAppValue')->willReturnCallback(function (string $app, string $key, string $value): void {
			$this->store[$key] = $value;
		});

		$users = $this->createMock(IUserManager::class);
		$users->method('get')->willReturnCallback(function (string $uid) {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($uid);
			$user->method('getDisplayName')->willReturn($uid);
			$user->method('isEnabled')->willReturn(true);
			return $user;
		});

		$session = $this->createMock(IUserSession::class);
		if ($sessionUid !== null) {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($sessionUid);
			$session->method('getUser')->willReturn($user);
		} else {
			$session->method('getUser')->willReturn(null);
		}

		$groups = $this->createMock(IGroupManager::class);
		$groups->method('isAdmin')->willReturnCallback(fn (string $uid): bool => $uid === 'admin');

		return new AccessControlService(
			$config,
			$groups,
			$session,
			$users,
			$this->createMock(LoggerInterface::class),
		);
	}

	protected function setUp(): void
	{
		parent::setUp();
		$this->store = [
			AccessControlService::KEY_ACCESS_RESTRICTION => '0',
			AccessControlService::KEY_APP_ADMINS => '[]',
			AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS => '[]',
			AccessControlService::KEY_ACCESS_ALLOWED_GROUP_IDS => '[]',
			AccessControlService::KEY_DEFAULT_LIBRARY_FOLDER => '/',
			AccessControlService::KEY_MAX_META_TEMP_MB => '256',
			AccessControlService::KEY_POLICY_VERSION => '3',
		];
	}

	public function testGetAppPolicyExposesVersion(): void
	{
		$svc = $this->makeService();
		$policy = $svc->getAppPolicy();
		$this->assertSame(3, $policy['policyVersion']);
	}

	public function testSectionAccessSaveDoesNotWipeAdminsOrDefaults(): void
	{
		$this->store[AccessControlService::KEY_APP_ADMINS] = json_encode(['delegate'], JSON_THROW_ON_ERROR);
		$this->store[AccessControlService::KEY_DEFAULT_LIBRARY_FOLDER] = 'Music';
		$this->store[AccessControlService::KEY_MAX_META_TEMP_MB] = '128';

		$svc = $this->makeService();
		$before = $svc->getAppPolicy();
		$out = $svc->saveAppPolicy([
			'section' => 'access',
			'policyVersion' => $before['policyVersion'],
			'accessRestrictionEnabled' => true,
			'allowedUserIds' => ['alice'],
			'allowedGroupIds' => [],
			// Stale sibling fields that MUST be ignored for section saves:
			'appAdminUserIds' => [],
			'defaultLibraryFolder' => 'Hacked',
			'maxMetaTempMb' => 16,
		]);

		$this->assertTrue($out['accessRestrictionEnabled']);
		$this->assertSame(['alice'], $out['allowedUserIds']);
		$this->assertSame(['delegate'], $out['appAdminUserIds']);
		$this->assertSame('Music', $out['defaultLibraryFolder']);
		$this->assertSame(128, $out['maxMetaTempMb']);
		$this->assertSame(4, $out['policyVersion']);
	}

	public function testSectionAdminsSaveDoesNotWipeAllowlists(): void
	{
		$this->store[AccessControlService::KEY_ACCESS_RESTRICTION] = '1';
		$this->store[AccessControlService::KEY_ACCESS_ALLOWED_USER_IDS] = json_encode(['alice'], JSON_THROW_ON_ERROR);

		$svc = $this->makeService();
		$before = $svc->getAppPolicy();
		$out = $svc->saveAppPolicy([
			'section' => 'admins',
			'policyVersion' => $before['policyVersion'],
			'appAdminUserIds' => ['delegate'],
			'accessRestrictionEnabled' => false,
			'allowedUserIds' => [],
			'allowedGroupIds' => [],
		]);

		$this->assertSame(['delegate'], $out['appAdminUserIds']);
		$this->assertTrue($out['accessRestrictionEnabled']);
		$this->assertSame(['alice'], $out['allowedUserIds']);
	}

	public function testStalePolicyVersionRaisesConflict(): void
	{
		$svc = $this->makeService();
		$this->expectException(ConflictException::class);
		$svc->saveAppPolicy([
			'section' => 'defaults',
			'policyVersion' => 1, // store is 3
			'defaultLibraryFolder' => 'Audiobooks',
			'maxMetaTempMb' => 256,
		]);
	}

	public function testLegacyFullPayloadWithoutSectionStillReplacesAll(): void
	{
		$this->store[AccessControlService::KEY_APP_ADMINS] = json_encode(['delegate'], JSON_THROW_ON_ERROR);
		$svc = $this->makeService();
		$out = $svc->saveAppPolicy([
			'appAdminUserIds' => [],
			'accessRestrictionEnabled' => false,
			'allowedUserIds' => [],
			'allowedGroupIds' => [],
			'defaultLibraryFolder' => '/',
			'maxMetaTempMb' => 256,
		]);
		$this->assertSame([], $out['appAdminUserIds']);
		$this->assertGreaterThan(3, $out['policyVersion']);
	}

	public function testInvalidSectionRejected(): void
	{
		$svc = $this->makeService();
		$this->expectException(\InvalidArgumentException::class);
		$svc->saveAppPolicy(['section' => 'evil', 'policyVersion' => 3]);
	}
}
