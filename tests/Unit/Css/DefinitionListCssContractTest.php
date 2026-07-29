<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Css;

use PHPUnit\Framework\TestCase;

/**
 * Pins settings/help DL resets against Nextcloud core dt chrome
 * (width: 130px; text-align: end).
 */
final class DefinitionListCssContractTest extends TestCase {
	public function testControlsAndShortcutsNeutraliseNextcloudCoreDtChrome(): void {
		$css = (string) file_get_contents(dirname(__DIR__, 3) . '/css/app.css');
		self::assertNotSame('', $css);
		self::assertMatchesRegularExpression(
			'/\.ac-(?:controls-ref|shortcuts)__list\s+dt[^{]*\{[^}]*text-align:\s*start/s',
			$css,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-(?:controls-ref|shortcuts)__list\s+dt[^{]*\{[^}]*width:\s*auto/s',
			$css,
		);
	}
}
