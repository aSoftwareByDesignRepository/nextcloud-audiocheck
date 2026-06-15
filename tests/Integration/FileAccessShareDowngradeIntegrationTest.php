<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Exception\NotFoundException;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\Constants;
use OCP\Files\File;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Share\IManager as ShareManager;
use OCP\Share\IShare;
use Test\TestCase;

/** AC-TST-07: access removed when group membership is revoked (permission downgrade). */
final class FileAccessShareDowngradeIntegrationTest extends TestCase
{
	private const OWNER = 'ac_down_owner';
	private const RECIPIENT = 'ac_down_rcpt';
	private const GROUP = 'ac_down_grp';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		$this->cleanup();
	}

	protected function tearDown(): void
	{
		$this->cleanup();
	}

	private function cleanup(): void
	{
		if (!isset(\OC::$server)) {
			return;
		}
		/** @var IGroupManager $groupManager */
		$groupManager = \OC::$server->get(IGroupManager::class);
		if ($groupManager->groupExists(self::GROUP)) {
			$groupManager->get(self::GROUP)?->delete();
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::RECIPIENT] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testGroupShareInaccessibleAfterMembershipRemoved(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER, self::PASSWORD);
		$userManager->createUser(self::RECIPIENT, self::PASSWORD);

		/** @var IGroupManager $groupManager */
		$groupManager = \OC::$server->get(IGroupManager::class);
		$group = $groupManager->createGroup(self::GROUP);
		$group->addUser($userManager->get(self::RECIPIENT));

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::OWNER)->newFile('group-downgrade.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var ShareManager $shareManager */
		$shareManager = \OC::$server->get(ShareManager::class);
		$share = $shareManager->newShare();
		$share->setShareType(IShare::TYPE_GROUP);
		$share->setSharedWith(self::GROUP);
		$share->setSharedBy(self::OWNER);
		$share->setPermissions(Constants::PERMISSION_READ);
		$share->setNode($file);
		$shareManager->createShare($share);

		$access->resolveReadableFile(self::RECIPIENT, $fileId);

		$group->removeUser($userManager->get(self::RECIPIENT));

		try {
			$access->resolveReadableFile(self::RECIPIENT, $fileId);
			$this->fail('Expected NotFoundException after membership removal');
		} catch (NotFoundException) {
			$this->addToAssertionCount(1);
		}
		$this->assertFalse($access->isFileAccessible(self::RECIPIENT, $fileId));
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
