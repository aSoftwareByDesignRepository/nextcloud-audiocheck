<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Dashboard;

use OCA\AudioCheck\AppInfo\Application;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\Dashboard\IAPIWidgetV2;
use OCP\Dashboard\IButtonWidget;
use OCP\Dashboard\IIconWidget;
use OCP\Dashboard\Model\WidgetButton;
use OCP\Dashboard\Model\WidgetItem;
use OCP\Dashboard\Model\WidgetItems;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserSession;

class ContinueWidget implements IAPIWidgetV2, IButtonWidget, IIconWidget
{
	public function __construct(
		private IL10N $l10n,
		private IURLGenerator $urlGenerator,
		private PlaybackStateService $playback,
		private AccessControlService $access,
		private IUserSession $userSession,
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
		return 'icon-audio';
	}

	public function getIconUrl(): string
	{
		return $this->urlGenerator->imagePath(Application::APP_ID, 'app.svg');
	}

	public function getUrl(): ?string
	{
		return $this->urlGenerator->linkToRoute('audiocheck.page.index');
	}

	public function load(): void
	{
	}

	public function getItems(string $userId, ?string $since = null, int $limit = 7): array
	{
		if (!$this->access->canUseApp($userId)) {
			return [];
		}
		$items = [];
		foreach ($this->playback->getContinueListening($userId, $limit) as $row) {
			$items[] = new WidgetItem(
				(string)$row['title'],
				(string)$row['artist'],
				$this->urlGenerator->linkToRoute('audiocheck.page.index') . '?fileId=' . $row['fileId'],
				$this->urlGenerator->linkToRoute('audiocheck.cover.get', ['fileId' => $row['fileId']]),
			);
		}
		return $items;
	}

	public function getItemsV2(string $userId, ?string $since = null, int $limit = 7): WidgetItems
	{
		return new WidgetItems($this->getItems($userId, $since, $limit));
	}

	public function getWidgetButtons(string $userId): array
	{
		if (!$this->access->canUseApp($userId)) {
			return [];
		}
		return [
			new WidgetButton(
				WidgetButton::TYPE_MORE,
				$this->l10n->t('Open AudioCheck'),
				$this->urlGenerator->linkToRoute('audiocheck.page.index'),
				'icon-audio',
			),
		];
	}
}
