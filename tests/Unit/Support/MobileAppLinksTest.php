<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use OCA\AudioCheck\Support\MobileAppLinks;
use PHPUnit\Framework\TestCase;

/**
 * Pins Play Store / product URLs for the Get the App page (no user input in hrefs).
 */
final class MobileAppLinksTest extends TestCase
{
	public function testPlayStoreUrlIsCanonicalPackage(): void
	{
		$links = new MobileAppLinks();
		self::assertSame(
			'https://play.google.com/store/apps/details?id=de.softwarebydesign.audiocheck',
			$links->playStoreUrl(),
		);
		self::assertSame('de.softwarebydesign.audiocheck', $links->playStorePackageId());
		self::assertSame(MobileAppLinks::PLAY_STORE_URL, $links->playStoreUrl());
	}

	public function testProductAndPrivacyUrlsAreHttpsOnVendorOrigin(): void
	{
		$links = new MobileAppLinks();
		$enProduct = $links->productPageUrl('en');
		$deProduct = $links->productPageUrl('de_DE');
		$enPrivacy = $links->privacyPageUrl('en');
		$dePrivacy = $links->privacyPageUrl('de');

		foreach ([$enProduct, $deProduct, $enPrivacy, $dePrivacy] as $url) {
			self::assertStringStartsWith('https://nextcloud.software-by-design.de/', $url);
			self::assertDoesNotMatchRegularExpression('/[\\x00-\\x1F\\x7F]/', $url);
		}
		self::assertStringContainsString('/en/apps/audiocheck.html#mobile-app', $enProduct);
		self::assertStringContainsString('/de/apps/audiocheck.html#mobile-app', $deProduct);
		self::assertStringContainsString('privacy-audiocheck-mobile', $enPrivacy);
		self::assertStringContainsString('datenschutz-audiocheck-mobile', $dePrivacy);
	}

	public function testGermanLocaleDetection(): void
	{
		$links = new MobileAppLinks();
		self::assertTrue($links->isGermanLocale('de'));
		self::assertTrue($links->isGermanLocale('de_DE'));
		self::assertTrue($links->isGermanLocale('de-CH'));
		self::assertFalse($links->isGermanLocale('en'));
		self::assertFalse($links->isGermanLocale('den'));
		self::assertFalse($links->isGermanLocale('fr'));
	}
}
