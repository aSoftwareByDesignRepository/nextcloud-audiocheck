<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\AppInfo;

use PHPUnit\Framework\TestCase;

/** AC-TST-05 / §9.13 type gate: {fileId} routes map to int-typed controller parameters. */
final class RouteTypeGateTest extends TestCase
{
	public function testFileIdRoutesUseIntControllerParameters(): void
	{
		$routes = require dirname(__DIR__, 3) . '/appinfo/routes.php';
		$this->assertIsArray($routes);
		$fileIdRoutes = array_values(array_filter(
			$routes['routes'] ?? [],
			static fn (array $route): bool => str_contains((string)($route['url'] ?? ''), '{fileId}'),
		));
		$this->assertNotEmpty($fileIdRoutes);

		foreach ($fileIdRoutes as $route) {
			$name = (string)($route['name'] ?? '');
			$this->assertNotSame('', $name, 'Route missing name');
			[$controllerKey, $method] = explode('#', $name, 2);
			$controllerFile = $this->controllerPath($controllerKey);
			$this->assertFileExists($controllerFile, 'Missing controller for route ' . $name);
			$source = file_get_contents($controllerFile);
			$this->assertIsString($source);
			$this->assertMatchesRegularExpression(
				'/function\s+' . preg_quote($method, '/') . '\(\s*int\s+\$fileId\s*\)/',
				$source,
				'Route ' . $name . ' must declare int $fileId',
			);
		}
	}

	public function testFolderIdRoutesUseIntControllerParameters(): void
	{
		$routes = require dirname(__DIR__, 3) . '/appinfo/routes.php';
		$folderRoutes = array_values(array_filter(
			$routes['routes'] ?? [],
			static fn (array $route): bool => str_contains((string)($route['url'] ?? ''), '{folderId}'),
		));
		foreach ($folderRoutes as $route) {
			$name = (string)($route['name'] ?? '');
			[, $method] = explode('#', $name, 2);
			$source = file_get_contents($this->controllerPath(explode('#', $name, 2)[0]));
			$this->assertIsString($source);
			$this->assertMatchesRegularExpression(
				'/function\s+' . preg_quote($method, '/') . '\(\s*int\s+\$folderId\s*\)/',
				$source,
				'Route ' . $name . ' must declare int $folderId',
			);
		}
	}

	private function controllerPath(string $controllerKey): string
	{
		$map = [
			'api' => 'ApiController.php',
			'stream' => 'StreamController.php',
			'cover' => 'CoverController.php',
			'page' => 'PageController.php',
		];
		$file = $map[$controllerKey] ?? null;
		$this->assertNotNull($file, 'Unknown controller key: ' . $controllerKey);

		return dirname(__DIR__, 3) . '/lib/Controller/' . $file;
	}
}
