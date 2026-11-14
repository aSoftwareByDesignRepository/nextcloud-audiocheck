<?php
/**
 * Settings sub-page: Transfer configuration (test → production).
 * Two cards — Export (passphrase → .nctransfer download) and Import
 * (mode → file → passphrase → mandatory dry-run → confirm) — plus the
 * "Last transfer" receipt line. The report dialog is a native <dialog>.
 *
 * Synced from apps/_shared/config-transfer — do not edit app-side.
 *
 * @var array $_
 * @var \OCP\IL10N $l
 */
$isSystemAdmin = !empty($_['isSystemAdmin']);
$lastReceipt = is_array($_['transferLastReceipt'] ?? null) ? $_['transferLastReceipt'] : null;
?>
<section class="ac-card ac-section" aria-labelledby="ac-xfer-export-h" id="ac-transfer-export-card">
	<header class="ac-section__header">
		<div>
			<h2 id="ac-xfer-export-h"><?php p($l->t('Export configuration')); ?></h2>
			<p class="ac-section__sub"><?php p($l->t('Download all settings, catalogues and business data as one encrypted file — then import it on your production instance.')); ?></p>
		</div>
	</header>
	<div class="ac-callout ac-callout--info" role="note">
		<p><strong><?php p($l->t('Secrets are never included.')); ?></strong>
		<?php p($l->t('Passwords, tokens and salts stay on this instance — the file is encrypted and still does not carry them. It does contain user and group names: handle it like personal data.')); ?></p>
	</div>
	<form id="ac-transfer-export-form" class="ac-form" novalidate>
		<div class="ac-form-row">
			<label for="ac-transfer-passphrase"><?php p($l->t('Encryption passphrase')); ?></label>
			<div class="ac-input-group">
				<input type="password" id="ac-transfer-passphrase" name="passphrase" autocomplete="new-password" required minlength="12" aria-describedby="ac-transfer-passphrase-hint ac-transfer-passphrase-strength">
				<button type="button" class="ac-btn ac-btn--ghost" id="ac-transfer-passphrase-toggle" aria-pressed="false"><?php p($l->t('Show')); ?></button>
				<button type="button" class="ac-btn ac-btn--secondary" id="ac-transfer-passphrase-generate"><?php p($l->t('Generate')); ?></button>
			</div>
			<p class="ac-form-row__hint" id="ac-transfer-passphrase-hint"><?php p($l->t('At least 12 characters. Without this passphrase the file cannot be restored — store it safely.')); ?></p>
			<p class="ac-form-row__hint ac-transfer-strength" id="ac-transfer-passphrase-strength" role="status" aria-live="polite"></p>
		</div>
		<div class="ac-actions">
			<button type="submit" class="ac-btn ac-btn--primary" id="ac-transfer-export-btn">
				<?php p($l->t('Download encrypted transfer file')); ?>
			</button>
		</div>
	</form>
</section>

<section class="ac-card ac-section" aria-labelledby="ac-xfer-import-h" id="ac-transfer-import-card">
	<header class="ac-section__header">
		<div>
			<h2 id="ac-xfer-import-h"><?php p($l->t('Import configuration')); ?></h2>
			<p class="ac-section__sub"><?php p($l->t('Pick a transfer file, enter its passphrase, review the preview — then confirm. Nothing is written before you confirm.')); ?></p>
		</div>
	</header>
	<?php if ($lastReceipt !== null): ?>
	<p class="ac-transfer-last" id="ac-transfer-last">
		<?php p($l->t('Last transfer')); ?>:
		<strong><?php p((string)($lastReceipt['at'] ?? '—')); ?></strong>
		· <?php
			$transferMode = (string)($lastReceipt['mode'] ?? '');
			if ($transferMode === 'merge') {
				p($l->t('Merge'));
			} elseif ($transferMode === 'replace') {
				p($l->t('Replace'));
			} else {
				p($transferMode !== '' ? $transferMode : '—');
			}
		?>
		· <?php p(($lastReceipt['result'] ?? '') === 'applied' ? $l->t('applied') : $l->t('failed')); ?>
		<?php if (($lastReceipt['snapshotId'] ?? null) !== null): ?>
			· <?php p($l->t('undo via snapshot')); ?> <code><?php p((string)$lastReceipt['snapshotId']); ?></code>
		<?php endif; ?>
	</p>
	<?php endif; ?>
	<form id="ac-transfer-import-form" class="ac-form" novalidate>
		<fieldset class="ac-form-row ac-fieldset" aria-describedby="ac-transfer-replace-hint">
			<legend><?php p($l->t('Mode')); ?></legend>
			<div class="ac-choice-cards">
				<label class="ac-choice-card">
					<input type="radio" name="mode" value="merge" checked>
					<span class="ac-choice-card__copy">
						<span class="ac-choice-card__title"><?php p($l->t('Merge')); ?></span>
						<span class="ac-choice-card__hint"><?php p($l->t('add and update; nothing is deleted')); ?></span>
					</span>
				</label>
				<label class="ac-choice-card ac-choice-card--danger">
					<input type="radio" name="mode" value="replace" <?php if (!$isSystemAdmin): ?>disabled<?php endif; ?>>
					<span class="ac-choice-card__copy">
						<span class="ac-choice-card__title"><?php p($l->t('Replace')); ?></span>
						<span class="ac-choice-card__hint"><?php p($l->t('make identical to the file; prod-only rows are deleted')); ?></span>
					</span>
				</label>
			</div>
			<p class="ac-form-row__hint" id="ac-transfer-replace-hint">
				<?php if ($isSystemAdmin): ?>
					<?php p($l->t('Replace needs maintenance mode ON (occ maintenance:mode --on) — you will type REPLACE in the preview to confirm.')); ?>
				<?php else: ?>
					<?php p($l->t('Replace is available to Nextcloud system administrators only.')); ?>
				<?php endif; ?>
			</p>
		</fieldset>
		<div class="ac-form-row">
			<label for="ac-transfer-file"><?php p($l->t('Transfer file')); ?></label>
			<input type="file" id="ac-transfer-file" name="file" accept=".nctransfer,application/json" class="ac-file-input">
		</div>
		<div class="ac-form-row">
			<label for="ac-transfer-import-passphrase"><?php p($l->t('File passphrase')); ?></label>
			<div class="ac-input-group">
				<input type="password" id="ac-transfer-import-passphrase" name="import_passphrase" autocomplete="off">
				<button type="button" class="ac-btn ac-btn--ghost" id="ac-transfer-import-passphrase-toggle" aria-pressed="false"><?php p($l->t('Show')); ?></button>
			</div>
		</div>
		<div id="ac-transfer-import-status" class="ac-form-row__hint" role="status" aria-live="polite"></div>
	</form>
</section>

<dialog id="ac-transfer-report" class="ac-dialog ac-transfer-report" aria-labelledby="ac-transfer-report-h">
	<div class="ac-dialog__body">
		<h3 id="ac-transfer-report-h"><?php p($l->t('Import preview')); ?></h3>
		<p id="ac-transfer-report-verdict" class="ac-transfer-report__verdict"></p>
		<p id="ac-transfer-report-file" class="ac-form-row__hint"></p>
		<div id="ac-transfer-report-groups"></div>
	</div>
	<footer class="ac-dialog__footer">
		<div id="ac-transfer-replace-confirm" class="ac-form-row" hidden>
			<label for="ac-transfer-replace-token"><?php p($l->t('Type REPLACE to confirm')); ?></label>
			<input type="text" id="ac-transfer-replace-token" autocomplete="off" spellcheck="false" placeholder="REPLACE">
		</div>
		<div class="ac-actions">
			<button type="button" class="ac-btn ac-btn--secondary" id="ac-transfer-cancel" value="cancel"><?php p($l->t('Cancel')); ?></button>
			<button type="button" class="ac-btn ac-btn--primary" id="ac-transfer-confirm"><?php p($l->t('Apply import')); ?></button>
		</div>
	</footer>
</dialog>

<dialog id="ac-transfer-progress" class="ac-dialog" aria-labelledby="ac-transfer-progress-h" aria-live="polite">
	<div class="ac-dialog__body">
		<h3 id="ac-transfer-progress-h"><?php p($l->t('Applying import')); ?></h3>
		<progress id="ac-transfer-progress-bar" max="100" value="0"></progress>
		<p id="ac-transfer-progress-text"><?php p($l->t('Starting…')); ?></p>
		<p class="ac-form-row__hint"><?php p($l->t('You can close this — the result is saved and shown under “Last transfer”.')); ?></p>
	</div>
</dialog>

<div id="ac-transfer-result-live" class="ac-visually-hidden" role="status" aria-live="polite"></div>
