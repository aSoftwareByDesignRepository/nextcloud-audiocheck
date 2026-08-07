<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Css;

use PHPUnit\Framework\TestCase;

/**
 * Pins AudioCheck design-system theming against regressions that break
 * dark mode / high-contrast / WCAG (transparent tints, shell max-width traps,
 * missing token modules, pale danger fills).
 */
final class DesignSystemCssContractTest extends TestCase {
	private string $appCss;
	private string $tokensCss;
	private string $shellCss;
	private string $patternsCss;
	private string $bundle;

	protected function setUp(): void {
		parent::setUp();
		$root = dirname(__DIR__, 3);
		$this->appCss = (string) file_get_contents($root . '/css/app.css');
		$this->tokensCss = (string) file_get_contents($root . '/css/common/tokens.css');
		$this->shellCss = (string) file_get_contents($root . '/css/common/shell-chrome.css');
		$this->patternsCss = (string) file_get_contents($root . '/css/common/page-patterns.css');
		$a11y = (string) file_get_contents($root . '/css/common/accessibility.css');
		$themeBind = (string) file_get_contents($root . '/css/theme-bind.css');
		$this->bundle = implode("\n", [
			$this->appCss,
			$this->tokensCss,
			$this->shellCss,
			$this->patternsCss,
			$a11y,
			$themeBind,
		]);
		self::assertNotSame('', $this->appCss);
		self::assertNotSame('', $this->tokensCss);
	}

	public function testAppImportsCanonicalModules(): void {
		self::assertStringContainsString("@import url('common/tokens.css');", $this->appCss);
		self::assertStringContainsString("@import url('common/shell-chrome.css');", $this->appCss);
		self::assertStringContainsString("@import url('common/page-patterns.css');", $this->appCss);
		self::assertStringContainsString("@import url('common/accessibility.css');", $this->appCss);
		self::assertStringContainsString('AZ-PARITY-RADIUS-ENFORCER', $this->appCss);
	}

	public function testTypeScaleMatchesArbeitszeitCheck(): void {
		self::assertStringContainsString('--ac-fs-xs: 0.75rem', $this->tokensCss);
		self::assertStringContainsString('--ac-fs-sm: 0.875rem', $this->tokensCss);
		self::assertStringContainsString('--ac-fs-lg: 1.125rem', $this->tokensCss);
		self::assertStringContainsString('--ac-fs-2xl: 1.875rem', $this->tokensCss);
		self::assertStringContainsString('--ac-touch: 44px', $this->tokensCss);
		self::assertStringContainsString('--ac-touch-lg: 48px', $this->tokensCss);
		self::assertStringContainsString('--ac-space-8: 64px', $this->tokensCss);
	}

	public function testMutedTokenPrefersNextcloudMaxContrast(): void {
		self::assertMatchesRegularExpression(
			'/--ac-muted:\s*var\(\s*--color-text-maxcontrast/s',
			$this->tokensCss,
		);
	}

	public function testBordersUseDesignSystemInkMix(): void {
		self::assertMatchesRegularExpression(
			'/--ac-border:\s*color-mix\(in srgb, var\(--color-main-text\) 12%, transparent\)/s',
			$this->tokensCss,
		);
		self::assertMatchesRegularExpression(
			'/--ac-border-strong:\s*color-mix\(in srgb, var\(--color-main-text\) 24%, transparent\)/s',
			$this->tokensCss,
		);
	}

	public function testTintsMixIntoMainBackgroundNotTransparent(): void {
		self::assertMatchesRegularExpression(
			'/--ac-tint-info:\s*color-mix\([^;]*var\(--color-main-background\)/s',
			$this->tokensCss,
		);
		self::assertDoesNotMatchRegularExpression(
			'/--ac-tint-(?:info|warning|danger|success):\s*color-mix\([^;]*,\s*transparent\)/s',
			$this->tokensCss,
		);
	}

	public function testDangerFillUsesElementErrorNotPaleTint(): void {
		self::assertStringContainsString('--ac-danger-fill: var(--color-element-error', $this->tokensCss);
		self::assertStringContainsString('--ac-danger-on-fill:', $this->tokensCss);
		self::assertStringContainsString('var(--ac-danger-fill)', $this->shellCss);
		self::assertStringContainsString('var(--ac-danger-on-fill)', $this->shellCss);
	}

	public function testThemeTokensLiveOnBodyAndAppSurfaces(): void {
		self::assertMatchesRegularExpression(
			'/body\s*,\s*#content\[class\*="app-audiocheck"\]/s',
			$this->tokensCss,
		);
		self::assertStringContainsString('#app-content.ac-app', $this->tokensCss);
		self::assertStringContainsString('.ac-modal', $this->tokensCss);
	}

	public function testShellHasNoFixedContentMaxWidthTrap(): void {
		self::assertStringContainsString('max-width: none', $this->shellCss);
		self::assertDoesNotMatchRegularExpression(
			'/#app-content-wrapper\.ac-shell[^{]*\{[^}]*max-width:\s*12[08]0px/s',
			$this->appCss,
		);
	}

	public function testEmptyStatesAreNotBoxedCards(): void {
		self::assertStringContainsString('never frame empty states as cards', $this->patternsCss);
		self::assertMatchesRegularExpression(
			'/\.ac-empty--page[^{]*\{[^}]*border:\s*none/s',
			$this->patternsCss,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-empty--page[^{]*\{[^}]*box-shadow:\s*none/s',
			$this->patternsCss,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-empty-state__text[^{]*\{[^}]*max-width:\s*42ch/s',
			$this->patternsCss,
		);
	}

	public function testSkipLinkIsAbsolutelyPositionedOffscreen(): void {
		self::assertStringContainsString('Skip links (AZ parity) — CRITICAL', $this->shellCss);
		self::assertMatchesRegularExpression(
			'/\.ac-skip-link[^{]*\{[^}]*position:\s*absolute\s*!important/s',
			$this->shellCss,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-skip-link[^{]*\{[^}]*left:\s*-9999px/s',
			$this->shellCss,
		);
	}

	public function testSafeAreaAndMotionGuardsExist(): void {
		self::assertStringContainsString('env(safe-area-inset', $this->bundle);
		self::assertStringContainsString('prefers-reduced-motion: reduce', $this->bundle);
		self::assertStringContainsString('prefers-contrast: more', $this->bundle);
		self::assertStringContainsString('forced-colors: active', $this->bundle);
	}

	public function testAppSettingsHiddenSectionsForceDisplayNone(): void {
		self::assertMatchesRegularExpression(
			'/\.ac-app-settings-page\s+\.ac-section\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/s',
			$this->patternsCss,
		);
		self::assertMatchesRegularExpression(
			'/\[data-ac-settings-savebar\]\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/s',
			$this->patternsCss,
		);
	}

	public function testPageHeaderUsesAzcIconWellGeometry(): void {
		self::assertMatchesRegularExpression(
			'/\.ac-page-header__icon[^{]*\{[^}]*width:\s*56px/s',
			$this->shellCss,
		);
		self::assertMatchesRegularExpression(
			'/\.ac-page-header__actions[^{]*\{[^}]*min-height:\s*(?:var\(--ac-touch,\s*)?44px/s',
			$this->shellCss,
		);
	}
}
