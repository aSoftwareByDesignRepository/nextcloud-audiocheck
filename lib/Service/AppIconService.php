<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 AudioCheck contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\IURLGenerator;
use RuntimeException;

/**
 * Theme-safe AudioCheck icon URLs for header, dashboard, and search surfaces.
 *
 * - Header / app menu: white {@see app.svg} — NC applies invert CSS vars.
 * - Dashboard surfaces: black/uncoloured {@see app-dashboard.svg} /
 *   {@see app-dark.svg} — per {@see \OCP\Dashboard\IIconWidget}; clients apply
 *   background invert when the UI is dark.
 *
 * Icon URLs append the app version as a cache buster. Static SVG responses use
 * multi-month Cache-Control; without a query version, browsers keep a previously
 * cached white glyph after surface icons ship.
 */
final class AppIconService
{
	/** Preferred order for main-background surfaces (dashboard). */
	private const SURFACE_CANDIDATES = ['app-dashboard.svg', 'app-dark.svg', 'app.svg'];

	public function __construct(
		private readonly IURLGenerator $urlGenerator,
		private readonly IAppManager $appManager,
	) {
	}

	/**
	 * Relative image path for Nextcloud header / app navigation entry (white glyph).
	 */
	public function headerIconPath(): string
	{
		return $this->withCacheBust(
			$this->urlGenerator->imagePath(Application::APP_ID, 'app.svg')
		);
	}

	/**
	 * Relative image path for dashboard widgets (dark glyph).
	 */
	public function surfaceIconPath(): string
	{
		foreach (self::SURFACE_CANDIDATES as $iconFile) {
			try {
				return $this->withCacheBust(
					$this->urlGenerator->imagePath(Application::APP_ID, $iconFile)
				);
			} catch (RuntimeException) {
				// Try next candidate.
			}
		}

		try {
			return $this->urlGenerator->imagePath('core', 'filetypes/audio.svg');
		} catch (RuntimeException) {
			return '';
		}
	}

	/**
	 * Absolute URL for {@see \OCP\Dashboard\IIconWidget::getIconUrl()}.
	 */
	public function absoluteSurfaceIconUrl(): string
	{
		$path = $this->surfaceIconPath();
		if ($path === '') {
			return '';
		}
		return $this->urlGenerator->getAbsoluteURL($path);
	}

	/**
	 * Bust long-lived static-asset caches when the app (and thus icons) ship a new version.
	 */
	private function withCacheBust(string $path): string
	{
		if ($path === '') {
			return '';
		}
		$version = $this->appManager->getAppVersion(Application::APP_ID);
		if ($version === '') {
			return $path;
		}
		$separator = str_contains($path, '?') ? '&' : '?';
		return $path . $separator . 'v=' . rawurlencode($version);
	}
}
