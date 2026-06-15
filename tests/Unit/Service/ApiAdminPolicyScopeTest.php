<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/** AC-TST-10: admin APIs expose policy only, not user libraries. */
final class ApiAdminPolicyScopeTest extends TestCase
{
	public function testAdminApiSurfaceIsPolicyOnly(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Controller/ApiController.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function getAppPolicy', $source);
		$this->assertStringContainsString('function saveAppPolicy', $source);
		$this->assertStringNotContainsString('function listUserTracks', $source);
		$this->assertStringNotContainsString('function getUserLibrary', $source);
		$this->assertMatchesRegularExpression(
			'/function getAppPolicy\([^)]*\)[^{]*\{[^}]*requireAppAdmin/s',
			$source,
		);
		$routes = file_get_contents(dirname(__DIR__, 3) . '/appinfo/routes.php');
		$this->assertIsString($routes);
		$this->assertStringContainsString("api#getAppPolicy", $routes);
	}

	public function testListTracksRequiresCurrentUserScope(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Service/LibraryService.php');
		$this->assertIsString($source);
		$this->assertMatchesRegularExpression(
			'/function listTracks\([^)]*string \$userId/s',
			$source,
		);
	}
}
