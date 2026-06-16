<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

final class LibraryServiceFolderFacetTest extends TestCase
{
	public function testFolderFacetsCountTracksRecursivelyToMatchListTracks(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('Count tracks recursively per folder prefix so counts match listTracks(folder=…).', $source);
		$this->assertStringContainsString("while (\$current !== '.' && \$current !== '' && \$current !== 'files')", $source);
		$this->assertStringContainsString("\$like = \$this->db->escapeLikeParameter(\$folderPath) . '/%';", $source);
	}
}
