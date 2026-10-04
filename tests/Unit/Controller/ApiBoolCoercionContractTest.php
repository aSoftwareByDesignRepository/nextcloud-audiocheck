<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Controller;

use OCA\AudioCheck\Service\UserPrefsService;
use PHPUnit\Framework\TestCase;

/**
 * Mutation bodies are JSON, but a hand-rolled or form-encoded client can still
 * deliver the literal string "false" — and PHP's `(bool)"false"` is true
 * (dutycheck 0.3.4 corruption class). Request-boundary booleans in
 * ApiController must parse via UserPrefsService::coerceBool, never `(bool)`.
 */
final class ApiBoolCoercionContractTest extends TestCase
{
	public function testNoBoolCastsOnRequestBodyRemain(): void
	{
		$source = $this->controllerSource();
		$this->assertDoesNotMatchRegularExpression(
			'/\(bool\)\s*\(\s*\$body/',
			$source,
			'ApiController must not (bool)-cast JSON body fields — use UserPrefsService::coerceBool',
		);
		$this->assertDoesNotMatchRegularExpression(
			'/\(bool\)\s*\$body/',
			$source,
			'ApiController must not (bool)-cast JSON body fields — use UserPrefsService::coerceBool',
		);
	}

	public function testEveryMutationBoolFieldUsesCoerceBool(): void
	{
		$source = $this->controllerSource();
		foreach (
			[
				'finished',
				'shuffle',
				'isPinned',
				'includeSubfolders',
				'favorite',
				'listened',
			] as $field
		) {
			$this->assertMatchesRegularExpression(
				'/coerceBool\(\$body\[\'' . preg_quote($field, '/') . '\'/',
				$source,
				"Request field '$field' must be parsed via UserPrefsService::coerceBool",
			);
		}
	}

	public function testCoerceBoolParsesStringFalseAsFalse(): void
	{
		$this->assertFalse(UserPrefsService::coerceBool('false'));
		$this->assertFalse(UserPrefsService::coerceBool('0'));
		$this->assertFalse(UserPrefsService::coerceBool('FALSE '));
		$this->assertTrue(UserPrefsService::coerceBool('true'));
		$this->assertTrue(UserPrefsService::coerceBool('1'));
		$this->assertTrue(UserPrefsService::coerceBool(true));
		$this->assertFalse(UserPrefsService::coerceBool(false));
		$this->assertFalse(UserPrefsService::coerceBool(null));
	}

	private function controllerSource(): string
	{
		$path = dirname(__DIR__, 3) . '/lib/Controller/ApiController.php';
		$source = file_get_contents($path);
		$this->assertIsString($source);

		return $source;
	}
}
