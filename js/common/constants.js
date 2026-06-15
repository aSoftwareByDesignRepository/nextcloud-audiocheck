(function () {
	'use strict';

	const DEFAULT_SPEED_PRESETS = Array.from({ length: (400 - 50) / 25 + 1 }, (_, i) => 50 + i * 25);

	function readSpeedPresets() {
		try {
			const root = document.getElementById('app-content');
			const raw = root && root.dataset ? root.dataset.acSpeedPresets : '';
			if (!raw) return DEFAULT_SPEED_PRESETS;
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_SPEED_PRESETS;
			const out = parsed
				.map((v) => Math.round(Number(v)))
				.filter((n) => Number.isFinite(n) && n > 0);
			return out.length ? out : DEFAULT_SPEED_PRESETS;
		} catch (_) {
			return DEFAULT_SPEED_PRESETS;
		}
	}

	const FAVORITES_PLAYLIST_ID = 'favorites';

	window.AudioCheckConstants = {
		SPEED_PRESETS: readSpeedPresets(),
		FAVORITES_PLAYLIST_ID,
		isFavoritesPlaylist(id) {
			return id === FAVORITES_PLAYLIST_ID;
		},
		REPEAT_OFF: 'off',
		REPEAT_ONE: 'one',
		REPEAT_ALL: 'all',
	};
})();
