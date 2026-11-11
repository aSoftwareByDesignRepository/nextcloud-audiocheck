<?php
/**
 * @var array $_
 * @var \OCP\IL10N $l
 */
?>
<?php include __DIR__ . '/common/page-start.php'; ?>

<div id="ac-view-root" class="ac-view-root" data-ac-view="<?php p($_['viewId'] ?? 'home'); ?>"
	<?php if (!empty($_['playlistId'])): ?> data-ac-playlist-id="<?php p((string)$_['playlistId']); ?>"<?php endif; ?>
	<?php if (!empty($_['settingsSection'])): ?> data-ac-settings-section="<?php p((string)$_['settingsSection']); ?>"<?php endif; ?>>
	<div class="ac-view-loading" role="status" aria-live="polite">
		<span class="ac-sr-only"><?php p($l->t('Loading…')); ?></span>
		<span class="ac-skeleton ac-skeleton--title"></span>
		<span class="ac-skeleton ac-skeleton--card"></span>
	</div>
</div>

<?php if (($_['settingsSection'] ?? '') === 'transfer'): ?>
<?php /* The transfer settings page is a server-rendered island inside the
	SPA: the router wipes #ac-view-root on every render, so the markup ships
	inert in a <template> outside it; js/views/app-settings.js clones it
	into the rendered body for the 'transfer' section. */ ?>
<template id="ac-transfer-template"><?php include __DIR__ . '/parts/settings/transfer.php'; ?></template>
<?php endif; ?>

<div id="ac-announcer" class="ac-sr-only" aria-live="polite" aria-atomic="true"></div>
<div id="ac-toasts" class="ac-toasts" aria-live="polite"></div>

	</main>
	</div>

	<?php
	$acMiniPlayerGlobal = false;
	$acMiniPlayerHidden = (($_['viewId'] ?? 'home') === 'now-playing');
	include __DIR__ . '/partials/mini-player.php';
	?>
</div>

<?php include __DIR__ . '/common/page-end.php'; ?>
