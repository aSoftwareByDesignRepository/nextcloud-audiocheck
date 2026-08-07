<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use PHPUnit\Framework\TestCase;

final class ApiLibraryScopeContractTest extends TestCase
{
	public function testRemoveLibraryPurgesOutOfScopeTracks(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Controller/ApiController.php');
		$pos = strpos($source, 'function removeLibrary');
		$this->assertNotFalse($pos);
		$window = substr($source, $pos, 420);
		$this->assertStringContainsString('purgeTracksOutsideLibraries($userId)', $window);
	}

	public function testAddLibraryQueuesScanForNewFolders(): void
	{
		$source = (string)file_get_contents(dirname(__DIR__, 3) . '/lib/Controller/ApiController.php');
		$this->assertStringContainsString(
			'if (!$result[\'alreadyExisted\'] || $result[\'rescanRecommended\'])',
			$source,
		);
	}
}
