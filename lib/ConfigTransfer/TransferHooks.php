<?php

declare(strict_types=1);

/**
 * AudioCheck wiring for the shared transfer engine.
 *
 *  - requireTransferAdmin gates on the app's real door-admin role
 *    (AccessControlService::requireAppAdmin — system admins + configured
 *    app admins).
 *  - validateValue/normalizeValue delegate to the SAME normaliser the
 *    settings surface uses — AccessControlService::normalizeForWrite for
 *    every policy key (validator parity, NN-08).
 *  - writeMirrored runs the access policy through
 *    AccessControlService::saveAppPolicy in ONE atomic call — never raw
 *    setAppValue (NN-02, azc #46 class; the restricted-door-requires-
 *    allowlist invariant is cross-key). AudioCheck has no platform
 *    restriction mirror; 'mirrored' here means the atomic policy write.
 *  - createSafetySnapshot delegates to UpgradeBackupService for the
 *    mandatory pre-replace snapshot (FS-2).
 */

namespace OCA\AudioCheck\ConfigTransfer;

use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\UpgradeBackupService;
use OCP\IGroupManager;
use OCP\IUserManager;
use Psr\Log\LoggerInterface;

final class TransferHooks implements ConfigTransferHooks
{
	private const ACCESS_KEYS = [
		'access_restriction_enabled',
		'access_allowed_user_ids',
		'access_allowed_group_ids',
		'app_admin_user_ids',
	];

	public function __construct(
		private readonly AccessControlService $access,
		private readonly UpgradeBackupService $backups,
		private readonly IUserManager $userManager,
		private readonly IGroupManager $groupManager,
		private readonly LoggerInterface $logger,
	) {
	}

	public function requireTransferAdmin(string $uid): void
	{
		$this->access->requireAppAdmin($uid);
	}

	public function validateValue(string $key, string $value): ?string
	{
		try {
			$this->normalize($key, $value);
			return null;
		} catch (\InvalidArgumentException $e) {
			return $e->getMessage() !== '' ? $e->getMessage() : 'INVALID_VALUE';
		} catch (\JsonException) {
			return 'INVALID_JSON';
		} catch (\Throwable) {
			return 'INVALID_VALUE';
		}
	}

	public function normalizeValue(string $key, string $value): string
	{
		try {
			return $this->normalize($key, $value);
		} catch (\Throwable) {
			return $value; // validateValue already rejected bad input
		}
	}

	private function normalize(string $key, string $value): string
	{
		try {
			return $this->access->normalizeForWrite($key, $value);
		} catch (\InvalidArgumentException $e) {
			if ($e->getMessage() !== 'UNKNOWN_SETTING') {
				throw $e;
			}
			// Not a policy key — size guard only.
			return strlen($value) <= 65536
				? $value
				: throw new \InvalidArgumentException('TOO_LONG');
		}
	}

	public function validateMirrored(array $keyValues): ?string
	{
		// Decode the mirrored policy values and run the same invariants
		// saveAppPolicy enforces — but WITHOUT writing.
		$decoded = $this->decodePolicy($keyValues);
		if ($decoded === null) {
			return 'INVALID_POLICY_JSON';
		}
		[$admins, $users, $groups, $restricted] = $decoded;
		foreach ($admins as $uid) {
			if (!$this->knownEnabledUser($uid)) {
				return 'INVALID_APP_ADMIN_USER';
			}
		}
		foreach ($users as $uid) {
			if (!$this->knownEnabledUser($uid)) {
				return 'INVALID_ALLOWED_USER';
			}
		}
		foreach ($groups as $gid) {
			if ($this->groupManager->get($gid) === null) {
				return 'INVALID_ALLOWED_GROUP';
			}
		}
		if ($restricted && $users === [] && $groups === []) {
			return 'ACCESS_LIST_REQUIRED';
		}
		return null;
	}

	public function writeMirrored(array $keyValues): void
	{
		$decoded = $this->decodePolicy($keyValues);
		if ($decoded === null) {
			throw new \InvalidArgumentException('INVALID_POLICY_JSON');
		}
		[$admins, $users, $groups, $restricted] = $decoded;
		// One atomic policy write through the app's central writer — the
		// payload carries all four fields plus the CAS token the writer
		// requires, so a partial transfer file never wipes the sections it
		// does not mention (decodePolicy overlays current state).
		$this->access->saveAppPolicy([
			'appAdminUserIds' => $admins,
			'allowedUserIds' => $users,
			'allowedGroupIds' => $groups,
			'accessRestrictionEnabled' => $restricted,
			'policyVersion' => $this->access->getAppPolicy()['policyVersion'],
		]);
	}

	/**
	 * Overlay the transferred mirrored keys onto the current policy, so a
	 * file that carries only a subset never blanks the rest.
	 *
	 * @return array{0:list<string>,1:list<string>,2:list<string>,3:bool}|null
	 */
	private function decodePolicy(array $kv): ?array
	{
		$current = $this->access->getAppPolicy();
		$admins = $current['appAdminUserIds'];
		$users = $current['allowedUserIds'];
		$groups = $current['allowedGroupIds'];
		$restricted = $current['accessRestrictionEnabled'];
		if (isset($kv['app_admin_user_ids'])) {
			$admins = json_decode($kv['app_admin_user_ids'], true);
			if (!is_array($admins)) {
				return null;
			}
		}
		if (isset($kv['access_allowed_user_ids'])) {
			$users = json_decode($kv['access_allowed_user_ids'], true);
			if (!is_array($users)) {
				return null;
			}
		}
		if (isset($kv['access_allowed_group_ids'])) {
			$groups = json_decode($kv['access_allowed_group_ids'], true);
			if (!is_array($groups)) {
				return null;
			}
		}
		if (isset($kv['access_restriction_enabled'])) {
			$restricted = $kv['access_restriction_enabled'] === '1';
		}
		return [
			array_values(array_map('strval', $admins)),
			array_values(array_map('strval', $users)),
			array_values(array_map('strval', $groups)),
			(bool)$restricted,
		];
	}

	/** saveAppPolicy's real check: the account must exist AND be enabled. */
	private function knownEnabledUser(string $uid): bool
	{
		$user = $this->userManager->get($uid);
		return $user !== null && $user->isEnabled();
	}

	public function securityRelevantKeys(): array
	{
		return self::ACCESS_KEYS;
	}

	public function createSafetySnapshot(string $reason): ?string
	{
		try {
			$result = $this->backups->createSnapshot($reason);
			return (string)($result['id'] ?? '');
		} catch (\Throwable) {
			// No data to back up yet (fresh instance) — not an error, but no
			// snapshot id either; the apply must not be silently unprotected
			// when tables DO exist, so rethrow real failures on non-empty DBs.
			if ($this->backups->hasDataToBackup()) {
				throw new \RuntimeException('TRANSFER_SNAPSHOT_FAILED');
			}
			return null;
		}
	}

	public function settingsSectionForKey(string $key): ?string
	{
		return match (true) {
			$key === 'app_admin_user_ids' => 'admins',
			str_starts_with($key, 'access_') => 'access',
			str_starts_with($key, 'default_'), str_starts_with($key, 'max_') => 'defaults',
			default => null,
		};
	}

	public function auditEvent(string $action, string $actor, array $details): void
	{
		// warning-level like every policy mutation in this app — the stock
		// NC loglevel=2 drops info entries, and an audit trail must be
		// durable on default configs.
		$this->logger->warning('audiocheck: config transfer ' . $action, [
			'app' => 'audiocheck',
			'actor' => $actor === '' ? 'cli' : $actor,
			'details' => $details,
		]);
	}
}
