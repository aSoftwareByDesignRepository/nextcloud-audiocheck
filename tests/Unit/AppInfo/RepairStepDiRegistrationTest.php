<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\AppInfo;

use OCP\IConfig;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionNamedType;

final class RepairStepDiRegistrationTest extends TestCase
{
	public static function repairStepClassesFromInfoXml(): array
	{
		$infoPath = dirname(__DIR__, 3) . '/appinfo/info.xml';
		$contents = file_get_contents($infoPath);
		$xml = simplexml_load_string($contents ?: '');
		$classes = [];
		foreach ($xml->{'repair-steps'}->children() as $phase) {
			foreach ($phase->step as $step) {
				$classes[] = (string)$step;
			}
		}
		$unique = array_values(array_unique($classes));
		return array_combine($unique, array_map(static fn (string $c): array => [$c], $unique));
	}

	/** @dataProvider repairStepClassesFromInfoXml */
	public function testRepairStepIsRegisteredInApplication(string $class): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/AppInfo/Application.php');
		$short = (new ReflectionClass($class))->getShortName();
		$this->assertMatchesRegularExpression(
			'/registerService\((?:\\\\?' . preg_quote($short, '/') . '|' . preg_quote($class, '/') . ')::class/',
			$source ?: '',
		);
	}

	/** @dataProvider repairStepClassesFromInfoXml */
	public function testRepairStepFactoryPassesEnoughConstructorArguments(string $class): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/AppInfo/Application.php') ?: '';
		$short = (new ReflectionClass($class))->getShortName();
		preg_match('/registerService\(' . preg_quote($short, '/') . '::class,\s*function\s*\(\$c\)[^{]*\{\s*return new ' . preg_quote($short, '/') . '\((.*?)\);/s', $source, $m);
		$this->assertNotEmpty($m, 'Factory not found for ' . $class);
		$required = (new ReflectionClass($class))->getConstructor()?->getNumberOfRequiredParameters() ?? 0;
		$passed = substr_count($m[1], '$c->query(');
		$this->assertGreaterThanOrEqual($required, $passed);
	}

	public function testEnsureSchemaRepairStepsWireIConfigWhenRequired(): void
	{
		$source = file_get_contents(dirname(__DIR__, 3) . '/lib/AppInfo/Application.php') ?: '';
		foreach (array_keys(self::repairStepClassesFromInfoXml()) as $class) {
			$ref = new ReflectionClass($class);
			if (!str_starts_with($ref->getShortName(), 'Ensure')) {
				continue;
			}
			foreach ($ref->getConstructor()?->getParameters() ?? [] as $param) {
				$type = $param->getType();
				if ($type instanceof ReflectionNamedType && $type->getName() === IConfig::class) {
					$this->assertMatchesRegularExpression(
						'/registerService\(' . preg_quote($ref->getShortName(), '/') . '::class,.*?IConfig::class/s',
						$source,
					);
				}
			}
		}
	}
}
