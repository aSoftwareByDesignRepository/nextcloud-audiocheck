<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Service;

use PHPUnit\Framework\TestCase;

/** AC-TST-10 / INV-AUTH-4: admin APIs are policy/search only and always call requireAppAdmin. */
final class ApiAdminPolicyScopeTest extends TestCase
{
	public function testAdminApiSurfaceIsPolicyOnly(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/Controller/ApiController.php');
		$this->assertIsString($source);
		$this->assertStringContainsString('function getAppPolicy', $source);
		$this->assertStringContainsString('function saveAppPolicy', $source);
		$this->assertStringContainsString('function searchUsers', $source);
		$this->assertStringContainsString('function searchGroups', $source);
		$this->assertStringNotContainsString('function listUserTracks', $source);
		$this->assertStringNotContainsString('function getUserLibrary', $source);

		foreach (['getAppPolicy', 'saveAppPolicy', 'searchUsers', 'searchGroups'] as $method) {
			$this->assertMatchesRegularExpression(
				'/function ' . $method . '\([^)]*\)[^{]*\{[\s\S]{0,400}?requireAppAdmin/m',
				$source,
				$method . ' must call requireAppAdmin before work',
			);
		}

		$routes = file_get_contents(dirname(__DIR__, 3) . '/appinfo/routes.php');
		$this->assertIsString($routes);
		$this->assertStringContainsString("api#getAppPolicy", $routes);
		$this->assertStringContainsString("api#saveAppPolicy", $routes);
		$this->assertStringContainsString("api#searchUsers", $routes);
		$this->assertStringContainsString("api#searchGroups", $routes);
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
