<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use OCA\AudioCheck\Repair\EnsureAudioCheckSchema;
use OCA\AudioCheck\Repair\UninstallDropTables;
use OCP\Migration\IOutput;
use Test\TestCase;

final class UpgradeRepairIntegrationTest extends TestCase
{
	protected function setUp(): void
	{
		if (!class_exists(\OC::class) || !isset(\OC::$server)) {
			$this->markTestSkipped('Nextcloud is not bootstrapped (run inside Docker with NEXTCLOUD_ROOT).');
		}
	}

	public function testRepairStepsResolveFromContainer(): void
	{
		foreach ([
			EnsureAudioCheckSchema::class,
			UninstallDropTables::class,
		] as $class) {
			$step = \OC::$server->get($class);
			$this->assertInstanceOf($class, $step);
		}
	}

	public function testEnsureAudioCheckSchemaRunsWithoutFatal(): void
	{
		/** @var EnsureAudioCheckSchema $step */
		$step = \OC::$server->get(EnsureAudioCheckSchema::class);
		$output = $this->createMock(IOutput::class);
		$output->method('info');

		$step->run($output);
		$this->addToAssertionCount(1);
	}
}
