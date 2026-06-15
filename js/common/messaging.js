(function () {
	'use strict';
	window.AudioCheckMessaging = {
		toast(message, type) {
			if (window.OC && OC.Notification && OC.Notification.showTemporary) {
				OC.Notification.showTemporary(message, { type: type || 'info' });
			}
		},
		escape(text) {
			const d = document.createElement('div');
			d.textContent = text == null ? '' : String(text);
			return d.innerHTML;
		},
	};
})();
