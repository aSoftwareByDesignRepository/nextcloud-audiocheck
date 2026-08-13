<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use OCA\AudioCheck\Service\IconCatalog;
use PHPUnit\Framework\TestCase;

/**
 * Renders navigation.php for App settings expand/collapse SSR contracts.
 * Guards the SETTINGS-PAGES-STANDARD rule: children stay collapsed off settings.
 */
final class NavigationExpandRenderTest extends TestCase
{
	protected function setUp(): void
	{
		parent::setUp();
		require_once dirname(__DIR__) . '/Support/template_stubs.php';
	}

	public function testCollapsedAppSettingsOmitsExpandedAndSetsHidden(): void
	{
		$html = $this->renderNav([
			[
				'title' => 'Account',
				'items' => [$this->appSettingsItem(expanded: false, activeSection: null)],
			],
		]);

		self::assertStringContainsString('data-ac-nav-id="app-settings"', $html);
		self::assertStringContainsString('ac-nav__item--has-children', $html);
		self::assertStringNotContainsString('is-expanded', $html);
		self::assertMatchesRegularExpression(
			'/aria-expanded="false"/',
			$html,
		);
		self::assertMatchesRegularExpression(
			'/<ul class="ac-nav__children"\s+hidden>/',
			$html,
		);
		self::assertStringContainsString('data-ac-nav-id="app-settings-access"', $html);
		self::assertStringContainsString('data-ac-nav-id="app-settings-admins"', $html);
	}

	public function testExpandedAppSettingsShowsChildrenAndMarksActiveChild(): void
	{
		$html = $this->renderNav([
			[
				'title' => 'Account',
				'items' => [$this->appSettingsItem(expanded: true, activeSection: 'access')],
			],
		]);

		self::assertStringContainsString('is-expanded', $html);
		self::assertMatchesRegularExpression(
			'/aria-expanded="true"/',
			$html,
		);
		self::assertDoesNotMatchRegularExpression(
			'/<ul class="ac-nav__children"\s+hidden>/',
			$html,
		);
		self::assertMatchesRegularExpression(
			'/data-ac-nav-id="app-settings-access"[\s\S]*?aria-current="page"/',
			$html,
		);
		self::assertDoesNotMatchRegularExpression(
			'/data-ac-nav-id="app-settings-admins"[\s\S]*?aria-current="page"/',
			$html,
		);
	}

	public function testParentKeepsActiveWithoutAriaCurrentWhenChildrenPresent(): void
	{
		$html = $this->renderNav([
			[
				'title' => 'Account',
				'items' => [$this->appSettingsItem(expanded: true, activeSection: 'defaults')],
			],
		]);

		// Parent is visually active but aria-current belongs to the child page.
		self::assertMatchesRegularExpression(
			'/<li class="[^"]*ac-nav__item--has-children[^"]*"\s+data-ac-nav-id="app-settings"[^>]*>\s*'
			. '<a href="[^"]+"\s+class="ac-nav__link ac-nav__link--active is-active active"\s+aria-expanded="true">/s',
			$html,
		);
		self::assertDoesNotMatchRegularExpression(
			'/<li class="[^"]*ac-nav__item--has-children[^"]*"\s+data-ac-nav-id="app-settings"[^>]*>\s*'
			. '<a[^>]*aria-current="page"/s',
			$html,
		);
		self::assertMatchesRegularExpression(
			'/data-ac-nav-id="app-settings-defaults"[\s\S]*?aria-current="page"/',
			$html,
		);
	}

	/**
	 * @param list<array{title: string, items: list<array<string, mixed>>}> $groups
	 */
	private function renderNav(array $groups): string
	{
		$_ = [
			'navigationGroups' => $groups,
			'appLogoUrl' => '/apps/audiocheck/img/app.svg',
		];
		$l = new class {
			public function t(string $text): string
			{
				return $text;
			}
		};

		ob_start();
		include dirname(__DIR__, 3) . '/templates/common/navigation.php';
		$html = (string) ob_get_clean();
		self::assertNotSame('', $html);
		self::assertNotSame('', IconCatalog::render('admin-settings'));
		return $html;
	}

	/**
	 * @return array<string, mixed>
	 */
	private function appSettingsItem(bool $expanded, ?string $activeSection): array
	{
		$sections = ['access', 'admins', 'defaults', 'support'];
		$children = [];
		foreach ($sections as $section) {
			$children[] = [
				'id' => 'app-settings-' . $section,
				'label' => ucfirst($section),
				'url' => '/apps/audiocheck/app-settings/' . $section,
				'active' => $activeSection === $section,
			];
		}
		return [
			'id' => 'app-settings',
			'label' => 'App settings',
			'hint' => 'Access policy and defaults',
			'url' => '/apps/audiocheck/app-settings/access',
			'icon' => 'admin-settings',
			'active' => $expanded,
			'expanded' => $expanded,
			'children' => $children,
		];
	}
}
