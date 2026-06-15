<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Controller\CoverController;
use OCA\AudioCheck\Service\FileAccessService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\File;
use OCP\IUserManager;
use OCP\IUserSession;
use Test\TestCase;

/** AC-TST-09: foreign cover requests return uniform 404 JSON. */
final class CoverForeignFileIntegrationTest extends TestCase
{
	private const OWNER = 'ac_cover_owner';
	private const ATTACKER = 'ac_cover_att';
	private const PASSWORD = 'ac-test-pass-9xK!';

	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::ATTACKER] as $uid) {
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
		/** @var IUserSession $session */
		$session = \OC::$server->get(IUserSession::class);
		$session->setUser(null);
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		foreach ([self::OWNER, self::ATTACKER] as $uid) {
			if ($userManager->userExists($uid)) {
				$userManager->get($uid)?->delete();
			}
		}
	}

	public function testForeignCoverReturnsUniformNotFoundJson(): void
	{
		/** @var IUserManager $userManager */
		$userManager = \OC::$server->get(IUserManager::class);
		$userManager->createUser(self::OWNER, self::PASSWORD);
		$userManager->createUser(self::ATTACKER, self::PASSWORD);

		/** @var FileAccessService $access */
		$access = \OC::$server->get(FileAccessService::class);
		/** @var File $file */
		$file = $access->getUserFolder(self::OWNER)->newFile('cover-secret.mp3');
		$file->putContent($this->minimalMp3Bytes());
		$fileId = (int)$file->getId();

		/** @var IUserSession $session */
		$session = \OC::$server->get(IUserSession::class);
		$session->setUser($userManager->get(self::ATTACKER));

		/** @var CoverController $controller */
		$controller = \OC::$server->get(CoverController::class);
		$response = $controller->get($fileId);

		$this->assertInstanceOf(JSONResponse::class, $response);
		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
		$data = $response->getData();
		$this->assertIsArray($data);
		$this->assertFalse($data['ok'] ?? true);
		$this->assertSame('not_found', $data['error']['code'] ?? null);
		$this->assertSame('not_found', $data['message'] ?? null);
	}

	private function minimalMp3Bytes(): string
	{
		return "ID3\x03\x00\x00\x00\x00\x00\x00"
			. "\xFF\xFB\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
	}
}
