<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use PHPUnit\Framework\TestCase;

/**
 * ArbeitszeitCheck shell parity contract for AudioCheck.
 * Fails the build when page chrome or design-system modules drift.
 *
 * Note: AudioCheck keeps a body-portal mobile drawer (#ac-nav-toggle) because
 * Nextcloud #content overflow:clip hides fixed descendants — documented exception
 * to “use NC drawer only”.
 */
final class AzcShellParityContractTest extends TestCase {
	private string $root;

	protected function setUp(): void {
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testShellFilesExist(): void {
		foreach ([
			'/css/common/tokens.css',
			'/css/common/shell-chrome.css',
			'/css/common/page-patterns.css',
			'/css/common/accessibility.css',
			'/css/app.css',
			'/css/theme-bind.css',
			'/templates/common/page-start.php',
			'/templates/common/navigation.php',
			'/templates/common/page-end.php',
			'/js/common/page-chrome.js',
			'/js/common/messaging.js',
			'/js/common/mobile-nav.js',
		] as $rel) {
			$this->assertFileExists($this->root . $rel, $rel);
		}
	}

	public function testPageChromeMatchesDesignSystemStructure(): void {
		$start = (string) file_get_contents($this->root . '/templates/common/page-start.php');
		foreach ([
			'ac-breadcrumb',
			'ac-breadcrumb__item--current',
			'ac-page-header__icon',
			'ac-page-header__lead',
			'ac-scope-strip',
			'ac-live-region',
			'ac-alert-region',
			'ac-skip-link',
			'ac-main-content',
			'href="#ac-main-content"',
			'data-ac-locale',
			'data-ac-timezone',
			'lang="',
		] as $token) {
			$this->assertStringContainsString($token, $start, 'page-start missing ' . $token);
		}
	}

	public function testNavigationUsesVisibleNameAndHint(): void {
		$nav = (string) file_get_contents($this->root . '/templates/common/navigation.php');
		$this->assertStringContainsString('ac-nav__name', $nav);
		$this->assertStringContainsString('ac-nav__hint', $nav);
		$this->assertStringContainsString('ac-nav__label', $nav);
		$this->assertStringContainsString('app-navigation', $nav);
	}

	public function testMessagingUsesToastAndLiveRegions(): void {
		$js = (string) file_get_contents($this->root . '/js/common/messaging.js');
		$this->assertStringContainsString('ac-live-region', $js);
		$this->assertStringContainsString('ac-alert-region', $js);
		$this->assertStringContainsString('announce', $js);
		$this->assertStringContainsString('toast', $js);
	}

	public function testMobileDrawerDocumentsOverflowClipException(): void {
		$js = (string) file_get_contents($this->root . '/js/common/mobile-nav.js');
		$this->assertStringContainsString('overflow:clip', $js);
		$this->assertStringContainsString('portal', strtolower($js));
		$this->assertStringContainsString('ac-nav-toggle', $js);
		$start = (string) file_get_contents($this->root . '/templates/common/page-start.php');
		$this->assertStringContainsString('ac-nav-toggle', $start);
	}

	public function testAppCssImportsShellModules(): void {
		$css = (string) file_get_contents($this->root . '/css/app.css');
		$this->assertStringContainsString("@import url('common/tokens.css');", $css);
		$this->assertStringContainsString('AZ-PARITY-RADIUS-ENFORCER', $css);
	}
}
