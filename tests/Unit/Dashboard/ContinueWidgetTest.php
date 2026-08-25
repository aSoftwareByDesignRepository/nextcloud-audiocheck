<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Dashboard;

use OCA\AudioCheck\Dashboard\ContinueWidget;
use OCA\AudioCheck\Service\AccessControlService;
use OCA\AudioCheck\Service\AppIconService;
use OCA\AudioCheck\Service\PlaybackStateService;
use OCP\App\IAppManager;
use OCP\Dashboard\Model\WidgetButton;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

final class ContinueWidgetTest extends TestCase
{
	private AccessControlService&MockObject $access;
	private PlaybackStateService&MockObject $playback;
	private IUserSession&MockObject $session;
	private ContinueWidget $widget;

	protected function setUp(): void
	{
		parent::setUp();
		$this->access = $this->createMock(AccessControlService::class);
		$this->playback = $this->createMock(PlaybackStateService::class);
		$this->session = $this->createMock(IUserSession::class);
		$url = $this->createMock(IURLGenerator::class);
		$url->method('imagePath')->willReturn('/apps/audiocheck/img/app-dashboard.svg');
		$url->method('getAbsoluteURL')->willReturnCallback(static fn (string $p) => 'https://nc.test' . $p);
		$url->method('linkToRouteAbsolute')->willReturn('https://nc.test/apps/audiocheck/');
		$l10n = $this->createMock(IL10N::class);
		$l10n->method('t')->willReturnCallback(static fn (string $s, array $a = []) => vsprintf(str_replace('%%', '%', $s), $a));
		$apps = $this->createMock(IAppManager::class);
		$apps->method('getAppVersion')->willReturn('1.2.20');
		$icons = new AppIconService($url, $apps);
		$this->widget = new ContinueWidget(
			$l10n,
			$url,
			$this->playback,
			$this->access,
			$this->session,
			$icons,
		);
	}

	public function testIconUrlUsesDarkSurfaceAsset(): void
	{
		$this->assertStringContainsString('app-dashboard.svg', $this->widget->getIconUrl());
		$this->assertStringStartsWith('https://', $this->widget->getIconUrl());
	}

	public function testDisabledWhenUserCannotUseApp(): void
	{
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('bob');
		$this->session->method('getUser')->willReturn($user);
		$this->access->method('canUseApp')->with('bob')->willReturn(false);
		$this->assertFalse($this->widget->isEnabled());
	}

	public function testItemsEmptyForDeniedUser(): void
	{
		$this->access->method('canUseApp')->with('bob')->willReturn(false);
		$this->playback->expects($this->never())->method('getContinueListening');
		$items = $this->widget->getItemsV2('bob');
		$this->assertSame([], $items->getItems());
		$this->assertStringContainsString('not available', $items->getEmptyContentMessage());
	}

	public function testItemsUseSurfaceIconNotCoverRoute(): void
	{
		$this->access->method('canUseApp')->with('alice')->willReturn(true);
		$this->playback->expects($this->once())
			->method('getContinueListening')
			->with('alice', 7)
			->willReturn([
				[
					'fileId' => 42,
					'title' => 'Kapitel 66',
					'artist' => 'Peter Bence',
				],
			]);
		$items = $this->widget->getItemsV2('alice', null, 7);
		$this->assertCount(1, $items->getItems());
		$item = $items->getItems()[0];
		$this->assertSame('Kapitel 66', $item->getTitle());
		$this->assertSame('Peter Bence', $item->getSubtitle());
		$this->assertStringContainsString('fileId=42', $item->getLink());
		$this->assertStringContainsString('app-dashboard.svg', $item->getIconUrl());
		$this->assertStringNotContainsString('cover', $item->getIconUrl());
	}

	public function testWidgetButtonUsesAbsoluteLinkAndLabelNotSwapped(): void
	{
		$this->access->method('canUseApp')->with('alice')->willReturn(true);
		$buttons = $this->widget->getWidgetButtons('alice');
		$this->assertCount(1, $buttons);
		$btn = $buttons[0];
		$this->assertSame(WidgetButton::TYPE_MORE, $btn->getType());
		$this->assertSame('https://nc.test/apps/audiocheck/', $btn->getLink());
		$this->assertSame('Open AudioCheck', $btn->getText());
		$this->assertStringNotContainsString('index.php', $btn->getText());
	}

	public function testLimitIsClamped(): void
	{
		$this->access->method('canUseApp')->with('alice')->willReturn(true);
		$this->playback->expects($this->once())
			->method('getContinueListening')
			->with('alice', 20)
			->willReturn([]);
		$this->widget->getItems('alice', null, 999);
	}
}
