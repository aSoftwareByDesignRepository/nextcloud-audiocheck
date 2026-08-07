<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Support;

use PHPUnit\Framework\TestCase;

/**
 * Bachus UX simplify — autosave prefs, progressive help, Open/Restricted access,
 * empty-state recovery, settings chips, no Save click for personal prefs.
 */
final class BachusSimplicityUxContractTest extends TestCase {
	private string $root;

	protected function setUp(): void {
		parent::setUp();
		$this->root = dirname(__DIR__, 3);
	}

	public function testPersonalSettingsAutosaveWithoutSaveButton(): void {
		$js = (string) file_get_contents($this->root . '/js/views/settings.js');
		$this->assertStringContainsString("data-ac-autosave", $js);
		$this->assertStringContainsString('Changes save automatically.', $js);
		$this->assertStringContainsString('scheduleSave', $js);
		$this->assertStringContainsString('persistPrefs', $js);
		$this->assertStringNotContainsString("text: t('audiocheck', 'Save')", $js);
		$this->assertStringContainsString('ac-disclosure', $js);
		$this->assertStringContainsString('Playback help and shortcuts', $js);
	}

	public function testAppSettingsUsesAccessModeOpenRestricted(): void {
		$js = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		$this->assertStringContainsString('ac-access-mode', $js);
		$this->assertStringContainsString("t('audiocheck', 'Open')", $js);
		$this->assertStringContainsString("t('audiocheck', 'Restricted')", $js);
		$this->assertStringContainsString('data-ac-access-allowlists', $js);
		$this->assertStringContainsString('syncAccessModeUi', $js);
		$this->assertStringContainsString("t('audiocheck', 'Save access')", $js);
		$this->assertStringNotContainsString("t('audiocheck', 'Restrict who may open the app')", $js);
	}

	public function testAppSettingsHasInPageSectionChips(): void {
		$js = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		$this->assertStringContainsString('ac-settings-chips', $js);
		$this->assertStringContainsString("id: 'access'", $js);
		$this->assertStringContainsString("id: 'admins'", $js);
		$this->assertStringContainsString("id: 'defaults'", $js);
		$this->assertStringContainsString("id: 'support'", $js);
		$this->assertStringContainsString('settingsChipBar', $js);
		$this->assertStringContainsString("'ac-settings-' + id", $js);
	}

	public function testEmptyStatesOfferRetryOnLoadFailures(): void {
		$home = (string) file_get_contents($this->root . '/js/views/home.js');
		$playlists = (string) file_get_contents($this->root . '/js/views/playlists.js');
		$appSettings = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		$components = (string) file_get_contents($this->root . '/js/common/components.js');
		$media = (string) file_get_contents($this->root . '/js/common/media-library-page.js');
		$facet = (string) file_get_contents($this->root . '/js/common/facet-browse-page.js');
		$library = (string) file_get_contents($this->root . '/js/views/library.js');
		$this->assertStringContainsString('loadErrorState', $components);
		$this->assertStringContainsString("t('audiocheck', 'Try again')", $components);
		$this->assertStringContainsString("t('audiocheck', 'Try again')", $home);
		$this->assertStringContainsString('loadErrorState', $playlists);
		$this->assertStringContainsString('loadErrorState', $appSettings);
		$this->assertStringContainsString('showLoadError', $media);
		$this->assertStringContainsString('showLoadError', $facet);
		$this->assertStringContainsString('loadErrorState', $library);
	}

	public function testAppSettingsShowsOneSectionAtATime(): void {
		$js = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		$this->assertStringContainsString('SECTION_ORDER', $js);
		$this->assertStringContainsString('settingsSection', $js);
		$this->assertStringContainsString('ac-settings-support', $js);
		$this->assertStringContainsString("t('audiocheck', 'Support')", $js);
		$this->assertStringContainsString("t('audiocheck', 'Save access')", $js);
		$this->assertStringContainsString("t('audiocheck', 'Save admins')", $js);
		$this->assertStringContainsString("t('audiocheck', 'Save defaults')", $js);
		$this->assertStringContainsString('ac-settings-topic', $js);
		$this->assertStringContainsString('ac-fieldset--plain', $js);
	}

	public function testNativeDialogHelperExists(): void {
		$js = (string) file_get_contents($this->root . '/js/common/components.js');
		$this->assertStringContainsString("createElement('dialog'", $js);
		$this->assertStringContainsString('ac-native-dialog', $js);
		$this->assertStringContainsString('showModal', $js);
		$this->assertStringContainsString('if (closed || submitting) return', $js);
		$this->assertStringContainsString('onClose', $js);
		$css = (string) file_get_contents($this->root . '/css/common/accessibility.css');
		$this->assertStringContainsString('dialog.ac-native-dialog:not([open])', $css);
	}

	public function testNowPlayingAdvancedOptionsAreDisclosed(): void {
		$js = (string) file_get_contents($this->root . '/js/views/now-playing.js');
		$this->assertStringContainsString('More playback options', $js);
		$this->assertStringContainsString('ac-now-advanced', $js);
		$this->assertStringContainsString('confirmDialog', $js);
		$this->assertStringContainsString('danger: true', $js);
		$this->assertStringContainsString('ac-now-field--sleep', $js);
		$this->assertStringNotContainsString('ac-now-sleep-details', $js);
		$this->assertStringNotContainsString("volumeControl({ idPrefix: 'ac-now' })", $js);
	}

	public function testAddToPlaylistEmptyOffersCreateCta(): void {
		$js = (string) file_get_contents($this->root . '/js/common/playlist-actions.js');
		$this->assertStringContainsString('Create a playlist to save these tracks.', $js);
		$this->assertStringContainsString("t('audiocheck', 'Create playlist')", $js);
		$this->assertStringContainsString('showCreateForm', $js);
		$this->assertStringContainsString('hideDefaultActions: true', $js);
		$this->assertStringContainsString('function playlistIdFrom', $js);
		$this->assertStringContainsString('AbortController', $js);
		$this->assertStringContainsString('onClose:', $js);
		$this->assertStringContainsString('onSubmit: async', $js);
		$this->assertStringNotContainsString('No playlists yet. Create one first.', $js);
	}

	public function testAppSettingsSectionScopedPolicySave(): void {
		$js = (string) file_get_contents($this->root . '/js/views/app-settings.js');
		$this->assertStringContainsString('policyVersion', $js);
		$this->assertStringContainsString("section,", $js);
		$this->assertStringContainsString('form.querySelector(', $js);
		$this->assertStringContainsString('mountAlive', $js);
		$this->assertStringContainsString('saveBtn.disabled = true', $js);
		$this->assertStringNotContainsString("document.getElementById('ac-policy-users-q')", $js);
	}

	public function testPlaylistRowActionsUseFullTouchTarget(): void {
		$css = (string) file_get_contents($this->root . '/css/app.css');
		$this->assertMatchesRegularExpression(
			'/\.ac-playlist-group__action[^{]*\{[^}]*min-height:\s*var\(--ac-touch/s',
			$css,
		);
		$this->assertStringContainsString('color: var(--color-primary-element-light-text', $css);
	}

	public function testPersonalSettingsLoadFailureOffersRetry(): void {
		$js = (string) file_get_contents($this->root . '/js/views/settings.js');
		$this->assertStringContainsString('loadErrorState', $js);
		$this->assertStringContainsString('Could not load settings', $js);
	}

	public function testEmptyStateComponentUsesDesignSystemClasses(): void {
		$js = (string) file_get_contents($this->root . '/js/common/components.js');
		$this->assertStringContainsString('ac-empty-state', $js);
		$this->assertStringContainsString('ac-empty-state__title', $js);
		$this->assertStringContainsString('ac-empty-state__text', $js);
		$this->assertStringContainsString('ac-btn--primary', $js);
	}

	public function testDisclosureSummaryHasTouchTargetInCss(): void {
		$css = (string) file_get_contents($this->root . '/css/common/page-patterns.css');
		$this->assertMatchesRegularExpression(
			'/\.ac-disclosure__summary[^{]*\{[^}]*min-height:\s*var\(--ac-touch/s',
			$css,
		);
		$this->assertStringContainsString('.ac-access-mode__option', $css);
		$this->assertStringContainsString('.ac-autosave-status', $css);
	}
}
