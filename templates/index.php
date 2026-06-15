<?php
/**
 * @var array $_
 * @var \OCP\IL10N $l
 */

use OCA\AudioCheck\Service\IconCatalog;
?>
<?php include __DIR__ . '/common/page-start.php'; ?>

<div id="ac-view-root" class="ac-view-root" data-ac-view="<?php p($_['viewId'] ?? 'home'); ?>"
	<?php if (!empty($_['playlistId'])): ?> data-ac-playlist-id="<?php p((string)$_['playlistId']); ?>"<?php endif; ?>>
	<div class="ac-view-loading" role="status" aria-live="polite">
		<span class="ac-skeleton ac-skeleton--title"></span>
		<span class="ac-skeleton ac-skeleton--card"></span>
	</div>
</div>

<div id="ac-announcer" class="ac-sr-only" aria-live="polite" aria-atomic="true"></div>

	</main>

	<footer id="ac-mini-player" class="ac-mini-player" role="region" aria-label="<?php p($l->t('Mini player')); ?>">
		<audio id="ac-audio" preload="metadata" playsinline></audio>
		<div class="ac-mini-player__inner">
			<button type="button" class="ac-mini-player__track ac-mini-player__track--idle" id="ac-mini-now"
				aria-label="<?php p($l->t('Open now playing')); ?>">
				<img class="ac-mini-player__cover" id="ac-mini-cover" src="" alt="" width="48" height="48" hidden>
				<span class="ac-mini-player__meta">
					<span class="ac-mini-player__title" id="ac-mini-title"><?php p($l->t('Nothing playing')); ?></span>
					<span class="ac-mini-player__artist" id="ac-mini-artist"></span>
				</span>
			</button>

			<div class="ac-mini-player__transport" role="group" aria-label="<?php p($l->t('Playback')); ?>">
				<button type="button" class="ac-btn ac-btn--icon" id="ac-mini-prev" aria-label="<?php p($l->t('Previous')); ?>">
					<?php print_unescaped(IconCatalog::render('previous')); ?>
				</button>
				<button type="button" class="ac-btn ac-btn--icon ac-btn--primary" id="ac-mini-play" aria-label="<?php p($l->t('Play')); ?>" aria-pressed="false">
					<?php print_unescaped(IconCatalog::render('play')); ?>
				</button>
				<button type="button" class="ac-btn ac-btn--icon" id="ac-mini-next" aria-label="<?php p($l->t('Next')); ?>">
					<?php print_unescaped(IconCatalog::render('next')); ?>
				</button>
			</div>

			<div class="ac-mini-player__seek" id="ac-mini-seek-wrap">
				<span class="ac-mini-player__time" id="ac-mini-pos" aria-hidden="true">0:00</span>
				<label class="ac-sr-only" for="ac-mini-seek"><?php p($l->t('Seek')); ?></label>
				<input type="range" class="ac-seek" id="ac-mini-seek" min="0" max="1000" value="0" aria-label="<?php p($l->t('Seek')); ?>">
				<span class="ac-mini-player__time" id="ac-mini-dur" aria-hidden="true">0:00</span>
			</div>

			<div class="ac-mini-player__side">
				<div class="ac-mini-player__volume" id="ac-mini-volume" role="group" aria-label="<?php p($l->t('Volume')); ?>"></div>
				<button type="button" class="ac-btn ac-btn--text ac-mini-player__open" id="ac-mini-expand" aria-label="<?php p($l->t('Open now playing')); ?>">
					<span class="ac-mini-player__open-label"><?php p($l->t('Now playing')); ?></span>
					<?php print_unescaped(IconCatalog::render('play', 'ac-mini-player__open-icon')); ?>
				</button>
			</div>
		</div>
	</footer>
</div>
</div>

<?php include __DIR__ . '/common/page-end.php'; ?>
