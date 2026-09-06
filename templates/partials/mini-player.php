<?php
/**
 * Shared mini-player chrome (in-app shell + global overlay).
 *
 * @var \OCP\IL10N $l
 * @var bool $acMiniPlayerGlobal When true, mark the footer for fixed overlay CSS.
 * @var bool $acMiniPlayerHidden When true, start hidden (global idle / now-playing).
 */

use OCA\AudioCheck\Service\IconCatalog;

$acMiniPlayerGlobal = !empty($acMiniPlayerGlobal);
$acMiniPlayerHidden = !empty($acMiniPlayerHidden);
$classes = 'ac-mini-player ac-mini-player--idle';
if ($acMiniPlayerGlobal) {
	$classes .= ' ac-mini-player--global';
}

/*
 * This partial is rendered both by the NC template engine (in-app) and via
 * MiniPlayerMarkupService::buildGlobalPayload (include + ob_start on Files).
 * Template helpers p()/print_unescaped() exist only in the engine path — define
 * local-safe fallbacks so the global overlay cannot 500 host apps.
 */
$acP = static function (mixed $value): void {
	if (\function_exists('p')) {
		p($value);
		return;
	}
	print htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
};
$acRaw = static function (mixed $value): void {
	if (\function_exists('print_unescaped')) {
		print_unescaped($value);
		return;
	}
	print (string)$value;
};
?>
<footer id="ac-mini-player" class="<?php $acP($classes); ?>" role="region" aria-label="<?php $acP($l->t('Mini player')); ?>"
	data-ac-mini-state="idle"
	<?php if ($acMiniPlayerHidden): ?>hidden aria-hidden="true"<?php endif; ?>>
	<audio id="ac-audio" preload="metadata" playsinline></audio>
	<div class="ac-mini-player__inner">
		<button type="button" class="ac-mini-player__track ac-mini-player__track--idle" id="ac-mini-now"
			aria-label="<?php $acP($l->t('Open now playing')); ?>">
			<img class="ac-mini-player__cover" id="ac-mini-cover" src="" alt="" width="48" height="48" hidden>
			<span class="ac-mini-player__meta">
				<span class="ac-mini-player__title" id="ac-mini-title"><?php $acP($acMiniPlayerGlobal ? $l->t('Loading playback…') : $l->t('Nothing playing')); ?></span>
				<span class="ac-mini-player__artist" id="ac-mini-artist"></span>
			</span>
		</button>

		<div class="ac-mini-player__transport" role="group" aria-label="<?php $acP($l->t('Playback')); ?>" hidden aria-hidden="true">
			<button type="button" class="ac-btn ac-transport-btn" id="ac-mini-prev" aria-label="<?php $acP($l->t('Previous')); ?>">
				<?php $acRaw(IconCatalog::render('previous')); ?>
			</button>
			<button type="button" class="ac-btn ac-transport-btn ac-transport-btn--jump" id="ac-mini-jump-back"
				aria-label="<?php $acP($l->t('Jump back 30 seconds')); ?>">
				<span class="ac-transport-jump" aria-hidden="true">
					<?php $acRaw(IconCatalog::render('rotate-ccw')); ?>
					<span class="ac-transport-jump__secs">30</span>
				</span>
			</button>
			<button type="button" class="ac-btn ac-transport-btn ac-transport-btn--primary" id="ac-mini-play" aria-label="<?php $acP($l->t('Play')); ?>" aria-pressed="false">
				<?php $acRaw(IconCatalog::render('play')); ?>
			</button>
			<button type="button" class="ac-btn ac-transport-btn ac-transport-btn--jump" id="ac-mini-jump-forward"
				aria-label="<?php $acP($l->t('Jump forward 30 seconds')); ?>">
				<span class="ac-transport-jump" aria-hidden="true">
					<?php $acRaw(IconCatalog::render('rotate-cw')); ?>
					<span class="ac-transport-jump__secs">30</span>
				</span>
			</button>
			<button type="button" class="ac-btn ac-transport-btn" id="ac-mini-next" aria-label="<?php $acP($l->t('Next')); ?>">
				<?php $acRaw(IconCatalog::render('next')); ?>
			</button>
		</div>

		<div class="ac-mini-player__seek" id="ac-mini-seek-wrap" hidden aria-hidden="true">
			<span class="ac-mini-player__time" id="ac-mini-pos" aria-hidden="true">0:00</span>
			<label class="ac-sr-only" for="ac-mini-seek"><?php $acP($l->t('Seek')); ?></label>
			<input type="range" class="ac-seek" id="ac-mini-seek" min="0" max="1000" value="0" aria-label="<?php $acP($l->t('Seek')); ?>">
			<span class="ac-mini-player__time" id="ac-mini-dur" aria-hidden="true">0:00</span>
		</div>

		<div class="ac-mini-player__side" hidden aria-hidden="true">
			<div class="ac-mini-player__volume" id="ac-mini-volume" role="group" aria-label="<?php $acP($l->t('Volume')); ?>"></div>
			<button type="button" class="ac-btn ac-btn--icon ac-mini-player__open" id="ac-mini-expand" aria-label="<?php $acP($l->t('Open now playing')); ?>">
				<?php $acRaw(IconCatalog::render('chevron-up', 'ac-mini-player__open-icon')); ?>
			</button>
			<button type="button" class="ac-btn ac-btn--icon ac-mini-player__close" id="ac-mini-close"
				aria-label="<?php $acP($l->t('Close player')); ?>"
				title="<?php $acP($l->t('Close player')); ?>"
				hidden aria-hidden="true" disabled>
				<?php $acRaw(IconCatalog::render('close', 'ac-mini-player__close-icon')); ?>
			</button>
		</div>
	</div>
</footer>
