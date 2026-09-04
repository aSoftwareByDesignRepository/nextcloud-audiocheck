<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\AppInfo\Application;
use OCP\L10N\IFactory;

/**
 * Renders the trusted mini-player partial for in-app and global overlays.
 */
class MiniPlayerMarkupService
{
	public function __construct(
		private IFactory $l10nFactory,
	) {
	}

	/**
	 * @return array{markup: string, nowPlayingUrl: string}
	 */
	public function buildGlobalPayload(string $nowPlayingUrl): array
	{
		$l = $this->l10nFactory->get(Application::APP_ID);
		$acMiniPlayerGlobal = true;
		$acMiniPlayerHidden = true;
		ob_start();
		include __DIR__ . '/../../templates/partials/mini-player.php';
		$markup = (string)ob_get_clean();

		$announcer = '<div id="ac-announcer" class="ac-sr-only" aria-live="polite" aria-atomic="true"></div>';
		$toasts = '<div id="ac-toasts" class="ac-toasts" aria-live="polite"></div>';

		return [
			'markup' => $announcer . $toasts . $markup,
			'nowPlayingUrl' => $nowPlayingUrl,
		];
	}
}
