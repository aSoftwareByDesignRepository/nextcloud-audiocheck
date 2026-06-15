<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\NotAuthenticatedException;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

/**
 * App-use gate for AudioCheck (Layer A). No workspace membership — any logged-in
 * user passes when restriction is off; app/system admins always pass.
 */
class AccessControlService
{
	public const KEY_APP_ADMINS = 'app_admin_user_ids';
	public const KEY_ACCESS_RESTRICTION = 'access_restriction_enabled';
	public const KEY_ACCESS_ALLOWED_USER_IDS = 'access_allowed_user_ids';
	public const KEY_ACCESS_ALLOWED_GROUP_IDS = 'access_allowed_group_ids';
	public const KEY_DEFAULT_LIBRARY_FOLDER = 'default_library_folder';
	public const KEY_MAX_META_TEMP_MB = 'max_meta_temp_mb';

	public const DENIAL_RESTRICTION = 'restriction';

	/** @var array<string, bool> */
	private array $groupMembershipCache = [];

	public function __construct(
		private IConfig $config,
		private IGroupManager $groupManager,
		private IUserSession $userSession,
		private IUserManager $userManager,
		private LoggerInterface $logger,
	) {
	}

	public function currentUserId(): string
	{
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new NotAuthenticatedException();
		}
		return $user->getUID();
	}

	public function isSystemAdmin(string $userId): bool
	{
		return $userId !== '' && $this->groupManager->isAdmin($userId);
	}

	public function isAppAdmin(string $userId): bool
	{
		if ($userId === '') {
			return false;
		}
		return $this->isSystemAdmin($userId) || in_array($userId, $this->getAppAdminIds(), true);
	}

	public function canUseApp(string $userId): bool
	{
		if ($userId === '') {
			return false;
		}
		if ($this->isAppAdmin($userId)) {
			return true;
		}
		if ($this->isAccessRestrictionEnabled() && !$this->userMatchesAccessAllowList($userId)) {
			return false;
		}
		return true;
	}

	public function denialReasonWhenCannotUseApp(string $userId): string
	{
		if ($this->isAccessRestrictionEnabled() && !$this->userMatchesAccessAllowList($userId) && !$this->isAppAdmin($userId)) {
			return self::DENIAL_RESTRICTION;
		}
		return self::DENIAL_RESTRICTION;
	}

	public function isAccessRestrictionEnabled(): bool
	{
		return $this->config->getAppValue(Application::APP_ID, self::KEY_ACCESS_RESTRICTION, '0') === '1';
	}

	public function requireAppAdmin(): string
	{
		$userId = $this->currentUserId();
		if (!$this->isAppAdmin($userId)) {
			throw new AccessDeniedException();
		}
		return $userId;
	}

	public function getDefaultLibraryFolder(): string
	{
		$value = trim((string)$this->config->getAppValue(Application::APP_ID, self::KEY_DEFAULT_LIBRARY_FOLDER, '/'));
		return $value !== '' ? $value : '/';
	}

	public function getMaxMetaTempMb(): int
	{
		$value = (int)$this->config->getAppValue(Application::APP_ID, self::KEY_MAX_META_TEMP_MB, '256');
		return $value > 0 ? $value : 256;
	}

	/**
	 * @return array{
	 *   appAdminUserIds:list<string>,
	 *   appAdminsPreview:list<array{id:string,displayName:string}>,
	 *   accessRestrictionEnabled:bool,
	 *   allowedUserIds:list<string>,
	 *   allowedGroupIds:list<string>,
	 *   allowedUsersPreview:list<array{id:string,displayName:string}>,
	 *   allowedGroupsPreview:list<array{id:string,displayName:string}>,
	 *   defaultLibraryFolder:string,
	 *   maxMetaTempMb:int
	 * }
	 */
	public function getAppPolicy(): array
	{
		$allowedUserIds = $this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_USER_IDS);
		$allowedGroupIds = $this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_GROUP_IDS);
		$appAdminUserIds = $this->getAppAdminIds();
		return [
			'appAdminUserIds' => $appAdminUserIds,
			'appAdminsPreview' => $this->previewUsers($appAdminUserIds),
			'accessRestrictionEnabled' => $this->isAccessRestrictionEnabled(),
			'allowedUserIds' => $allowedUserIds,
			'allowedGroupIds' => $allowedGroupIds,
			'allowedUsersPreview' => $this->previewUsers($allowedUserIds),
			'allowedGroupsPreview' => $this->previewGroups($allowedGroupIds),
			'defaultLibraryFolder' => $this->getDefaultLibraryFolder(),
			'maxMetaTempMb' => $this->getMaxMetaTempMb(),
		];
	}

	public function saveAppPolicy(array $payload): array
	{
		$adminCandidates = $payload['appAdminUserIds'] ?? [];
		if (!is_array($adminCandidates)) {
			throw new \InvalidArgumentException('appAdminUserIds must be an array.');
		}
		$normalised = [];
		foreach ($adminCandidates as $candidate) {
			if (!is_string($candidate)) {
				continue;
			}
			$candidate = trim($candidate);
			if ($candidate === '' || strlen($candidate) > 64) {
				continue;
			}
			$normalised[$candidate] = true;
		}
		$adminIds = array_keys($normalised);
		foreach ($adminIds as $adminId) {
			$user = $this->userManager->get($adminId);
			if ($user === null || !$user->isEnabled()) {
				throw new \InvalidArgumentException('One or more app administrator entries are invalid.');
			}
		}

		$currentUserId = $this->userSession->getUser()?->getUID() ?? '';
		if ($currentUserId !== '' && !$this->isSystemAdmin($currentUserId) && $this->isAppAdmin($currentUserId)) {
			if (!in_array($currentUserId, $adminIds, true) && $adminIds === []) {
				throw new \InvalidArgumentException('You cannot remove your own app administrator access without assigning another administrator first.');
			}
		}

		$restrictionRaw = $payload['accessRestrictionEnabled'] ?? false;
		$restrictionEnabled = $restrictionRaw === true || $restrictionRaw === 1 || $restrictionRaw === '1' || $restrictionRaw === 'true';

		$allowedUserIds = $this->normalizeUserIds(is_array($payload['allowedUserIds'] ?? null) ? $payload['allowedUserIds'] : []);
		$allowedGroupIds = $this->normalizeGroupIds(is_array($payload['allowedGroupIds'] ?? null) ? $payload['allowedGroupIds'] : []);
		if ($restrictionEnabled && $allowedUserIds === [] && $allowedGroupIds === []) {
			throw new \InvalidArgumentException('When access restriction is enabled, at least one allowed user or group is required.');
		}

		$defaultFolder = trim((string)($payload['defaultLibraryFolder'] ?? $this->getDefaultLibraryFolder()));
		if ($defaultFolder === '' || str_contains($defaultFolder, '..')) {
			throw new \InvalidArgumentException('Invalid default library folder.');
		}

		$maxMetaTempMb = (int)($payload['maxMetaTempMb'] ?? $this->getMaxMetaTempMb());
		if ($maxMetaTempMb < 16 || $maxMetaTempMb > 2048) {
			throw new \InvalidArgumentException('maxMetaTempMb must be between 16 and 2048.');
		}

		$this->config->setAppValue(Application::APP_ID, self::KEY_APP_ADMINS, json_encode($adminIds, JSON_THROW_ON_ERROR));
		$this->config->setAppValue(Application::APP_ID, self::KEY_ACCESS_RESTRICTION, $restrictionEnabled ? '1' : '0');
		$this->config->setAppValue(Application::APP_ID, self::KEY_ACCESS_ALLOWED_USER_IDS, json_encode($allowedUserIds, JSON_THROW_ON_ERROR));
		$this->config->setAppValue(Application::APP_ID, self::KEY_ACCESS_ALLOWED_GROUP_IDS, json_encode($allowedGroupIds, JSON_THROW_ON_ERROR));
		$this->config->setAppValue(Application::APP_ID, self::KEY_DEFAULT_LIBRARY_FOLDER, $defaultFolder);
		$this->config->setAppValue(Application::APP_ID, self::KEY_MAX_META_TEMP_MB, (string)$maxMetaTempMb);

		return $this->getAppPolicy();
	}

	/**
	 * @return list<array{id:string,displayName:string,enabled:bool}>
	 */
	public function searchUsers(string $query, int $limit = 25): array
	{
		$query = trim($query);
		if (mb_strlen($query) < 2) {
			return [];
		}
		$candidates = array_merge(
			$this->userManager->search($query, 50, 0),
			$this->userManager->searchDisplayName($query, 50, 0),
		);
		$users = [];
		foreach ($candidates as $user) {
			$uid = $user->getUID();
			if (isset($users[$uid])) {
				continue;
			}
			$users[$uid] = [
				'id' => $uid,
				'displayName' => $user->getDisplayName(),
				'enabled' => $user->isEnabled(),
			];
			if (count($users) >= $limit) {
				break;
			}
		}
		return array_values($users);
	}

	/**
	 * @return list<array{id:string,displayName:string}>
	 */
	public function searchGroups(string $query, int $limit = 25): array
	{
		$query = trim($query);
		if (mb_strlen($query) < 2) {
			return [];
		}
		$out = [];
		foreach ($this->groupManager->search($query, $limit, 0) as $group) {
			$out[] = [
				'id' => $group->getGID(),
				'displayName' => $group->getDisplayName(),
			];
		}
		return $out;
	}

	public function purgeUser(string $userId): void
	{
		if ($userId === '') {
			return;
		}
		$adminIds = array_values(array_filter(
			$this->getAppAdminIds(),
			static fn (string $id): bool => $id !== $userId,
		));
		$this->config->setAppValue(Application::APP_ID, self::KEY_APP_ADMINS, json_encode($adminIds, JSON_THROW_ON_ERROR));

		$allowUsers = array_values(array_filter(
			$this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_USER_IDS),
			static fn (string $id): bool => $id !== $userId,
		));
		$this->config->setAppValue(Application::APP_ID, self::KEY_ACCESS_ALLOWED_USER_IDS, json_encode($allowUsers, JSON_THROW_ON_ERROR));
	}

	public function purgeGroup(string $gid): void
	{
		if ($gid === '') {
			return;
		}
		$filtered = array_values(array_filter(
			$this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_GROUP_IDS),
			static fn (string $id): bool => $id !== $gid,
		));
		$this->config->setAppValue(Application::APP_ID, self::KEY_ACCESS_ALLOWED_GROUP_IDS, json_encode($filtered, JSON_THROW_ON_ERROR));
	}

	/** @return list<string> */
	private function getAppAdminIds(): array
	{
		$raw = (string)$this->config->getAppValue(Application::APP_ID, self::KEY_APP_ADMINS, '[]');
		try {
			$value = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			return [];
		}
		if (!is_array($value)) {
			return [];
		}
		return array_values(array_unique(array_filter($value, static fn ($v): bool => is_string($v) && $v !== '')));
	}

	private function userMatchesAccessAllowList(string $userId): bool
	{
		foreach ($this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_USER_IDS) as $uid) {
			if ($uid === $userId) {
				return true;
			}
		}
		foreach ($this->readJsonIdListConfig(self::KEY_ACCESS_ALLOWED_GROUP_IDS) as $gid) {
			if ($this->isUserInGroupCached($userId, $gid)) {
				return true;
			}
		}
		return false;
	}

	/** @return list<string> */
	private function readJsonIdListConfig(string $key): array
	{
		$raw = trim((string)$this->config->getAppValue(Application::APP_ID, $key, '[]'));
		if ($raw === '') {
			return [];
		}
		try {
			$data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			$this->logger->warning('Invalid JSON in AudioCheck access list', ['key' => $key]);
			return [];
		}
		if (!is_array($data)) {
			return [];
		}
		$out = [];
		foreach ($data as $item) {
			if (is_string($item) && $item !== '') {
				$out[] = $item;
			}
		}
		return array_values(array_unique($out));
	}

	/** @param list<string> $userIds @return list<array{id:string,displayName:string}> */
	private function previewUsers(array $userIds): array
	{
		$out = [];
		foreach ($userIds as $uid) {
			$user = $this->userManager->get($uid);
			$out[] = ['id' => $uid, 'displayName' => $user !== null ? $user->getDisplayName() : $uid];
		}
		return $out;
	}

	/** @param list<string> $groupIds @return list<array{id:string,displayName:string}> */
	private function previewGroups(array $groupIds): array
	{
		$out = [];
		foreach ($groupIds as $gid) {
			$group = $this->groupManager->get($gid);
			$out[] = ['id' => $gid, 'displayName' => $group !== null ? $group->getDisplayName() : $gid];
		}
		return $out;
	}

	/** @param list<mixed> $raw @return list<string> */
	private function normalizeUserIds(array $raw): array
	{
		$out = [];
		foreach ($raw as $id) {
			$id = is_string($id) ? trim($id) : '';
			if ($id === '' || strlen($id) > 64) {
				continue;
			}
			$user = $this->userManager->get($id);
			if ($user === null || !$user->isEnabled()) {
				throw new \InvalidArgumentException('One or more allowed user entries are invalid.');
			}
			$out[] = $id;
		}
		return array_values(array_unique($out));
	}

	/** @param list<mixed> $raw @return list<string> */
	private function normalizeGroupIds(array $raw): array
	{
		$out = [];
		foreach ($raw as $id) {
			$id = is_string($id) ? trim($id) : '';
			if ($id === '' || $this->groupManager->get($id) === null) {
				if ($id !== '') {
					throw new \InvalidArgumentException('One or more allowed group entries are invalid.');
				}
				continue;
			}
			$out[] = $id;
		}
		return array_values(array_unique($out));
	}

	private function isUserInGroupCached(string $userId, string $groupId): bool
	{
		$key = $userId . "\0" . $groupId;
		if (!array_key_exists($key, $this->groupMembershipCache)) {
			$this->groupMembershipCache[$key] = $this->groupManager->isInGroup($userId, $groupId);
		}
		return $this->groupMembershipCache[$key];
	}
}
