<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Dashboard;

use OCA\AudioCheck\AppInfo\Application;
use OCP\Util;

/**
 * Dashboard widgets render outside AudioCheck page templates — they must
 * register desklet styles in {@see \OCP\Dashboard\IWidget::load()} themselves.
 */
trait RegistersDeskletStylesTrait
{
	private static bool $deskletStylesRegistered = false;

	private function registerDeskletStylesForWidget(): void
	{
		if (self::$deskletStylesRegistered) {
			return;
		}
		self::$deskletStylesRegistered = true;
		Util::addStyle(Application::APP_ID, 'desklet-nextcloud');
	}
}
