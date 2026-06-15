(function () {
	'use strict';
	window.AudioCheckTime = {
		formatMs(ms) {
			ms = Math.max(0, Math.floor(ms || 0));
			const s = Math.floor(ms / 1000);
			const m = Math.floor(s / 60);
			const h = Math.floor(m / 60);
			const ss = String(s % 60).padStart(2, '0');
			const mm = String(m % 60).padStart(2, '0');
			return h > 0 ? h + ':' + String(m % 60).padStart(2, '0') + ':' + ss : mm + ':' + ss;
		},
		formatDuration(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return '—';
			return this.formatMs(ms);
		},
		formatDurationLabel(ms) {
			if (!Number.isFinite(ms) || ms <= 0) {
				return t('audiocheck', 'Duration unknown');
			}
			return t('audiocheck', 'Duration {time}', { time: this.formatMs(ms) });
		},
		sumDurationMs(tracks) {
			if (!Array.isArray(tracks)) return 0;
			return tracks.reduce((sum, tr) => sum + (Number(tr.durationMs) > 0 ? Number(tr.durationMs) : 0), 0);
		},
	};
})();
