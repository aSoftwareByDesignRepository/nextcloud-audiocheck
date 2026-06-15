<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

final class LibraryServicePlayableTest extends TestCase
{
	public function testPlayableTrackWorksWithoutIndexRow(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function getPlayableTrack', $source);
		$this->assertStringContainsString('function minimalTrackFromFile', $source);
		$this->assertStringContainsString('function listFolderTracks', $source);
	}

	public function testFileAccessServiceListsFolderAudio(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/FileAccessService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function listAudioFilesInFolder', $source);
	}
}
