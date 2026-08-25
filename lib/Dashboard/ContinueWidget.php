<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Dashboard;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\AppIconService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\Dashboard\IAPIWidgetV2;
use OCP\Dashboard\IButtonWidget;
use OCP\Dashboard\IConditionalWidget;
use OCP\Dashboard\IIconWidget;
use OCP\Dashboard\IReloadableWidget;
use OCP\Dashboard\Model\WidgetButton;
use OCP\Dashboard\Model\WidgetItem;
use OCP\Dashboard\Model\WidgetItems;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * Continue-listening desklet for the Nextcloud Dashboard.
 *
 * Red-team:
 * - Fail-closed on access control (no items / buttons / enable without canUseApp).
 * - Absolute URLs only (relative paths leak as button labels when WidgetButton
 *   args are swapped; open-redirect / mixed-content risk for remote clients).
 * - Theme-safe surface icons — never white header glyph or prefers-color-scheme
 *   cover placeholders (NC dark theme often keeps OS light color-scheme).
 * - Desklet CSS registered in load() (widgets render outside app templates).
 * - Limit clamped; inaccessible files already filtered by PlaybackStateService.
 */
class ContinueWidget implements IAPIWidgetV2, IButtonWidget, IIconWidget, IConditionalWidget, IReloadableWidget
{
	use RegistersDeskletStylesTrait;

	public function __construct(
		private IL10N $l10n,
		private IURLGenerator $urlGenerator,
		private PlaybackStateService $playback,
		private AccessControlService $access,
		private IUserSession $userSession,
		private AppIconService $appIcons,
	) {
	}

	public function getId(): string
	{
		return Application::APP_ID . '-continue';
	}

	public function getTitle(): string
	{
		return $this->l10n->t('Continue listening');
	}

	public function getOrder(): int
	{
		return 20;
	}

	public function getIconClass(): string
	{
		return 'icon-sound';
	}

	public function getIconUrl(): string
	{
		return $this->appIcons->absoluteSurfaceIconUrl();
	}

	public function getUrl(): ?string
	{
		return $this->urlGenerator->linkToRouteAbsolute('audiocheck.page.index');
	}

	public function getReloadInterval(): int
	{
		return 300;
	}

	public function isEnabled(): bool
	{
		$user = $this->userSession->getUser();
		if ($user === null) {
			return false;
		}
		return $this->access->canUseApp($user->getUID());
	}

	public function load(): void
	{
		$this->registerDeskletStylesForWidget();
	}

	public function getItems(string $userId, ?string $since = null, int $limit = 7): array
	{
		if (!$this->access->canUseApp($userId)) {
			return [];
		}
		$limit = max(1, min(20, $limit));
		$icon = $this->getIconUrl();
		$base = $this->getUrl() ?? '';
		$items = [];
		foreach ($this->playback->getContinueListening($userId, $limit) as $row) {
			$fileId = (int)$row['fileId'];
			$title = trim((string)($row['title'] ?? ''));
			$artist = trim((string)($row['artist'] ?? ''));
			$items[] = new WidgetItem(
				$title !== '' ? $title : $this->l10n->t('Untitled track'),
				$artist,
				$base . (str_contains($base, '?') ? '&' : '?') . 'fileId=' . $fileId,
				$icon,
				(string)$fileId,
			);
		}
		return $items;
	}

	public function getItemsV2(string $userId, ?string $since = null, int $limit = 7): WidgetItems
	{
		$items = $this->getItems($userId, $since, $limit);
		$empty = $this->l10n->t('Nothing to continue. Open AudioCheck to play a track.');
		if (!$this->access->canUseApp($userId)) {
			return new WidgetItems([], $this->l10n->t('AudioCheck is not available for your account.'));
		}
		return new WidgetItems($items, $items === [] ? $empty : '');
	}

	public function getWidgetButtons(string $userId): array
	{
		if (!$this->access->canUseApp($userId)) {
			return [];
		}
		return [
			new WidgetButton(
				WidgetButton::TYPE_MORE,
				$this->urlGenerator->linkToRouteAbsolute('audiocheck.page.index'),
				$this->l10n->t('Open AudioCheck'),
			),
		];
	}
}
