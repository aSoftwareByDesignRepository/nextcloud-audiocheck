(function () {
	'use strict';

	const SVG_NS = 'http://www.w3.org/2000/svg';

	/** Keep in sync with {@see OCA\AudioCheck\Service\IconCatalog}. */
	const ICON_SHAPES = {
		home: [
			{ tag: 'path', d: 'M3 10.5 12 3l9 7.5' },
			{ tag: 'path', d: 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5' },
		],
		audiobook: [
			{ tag: 'path', d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' },
			{ tag: 'path', d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z' },
			{ tag: 'path', d: 'M8 7h8' },
		],
		music: [
			{ tag: 'path', d: 'M9 18V5l12-2v13' },
			{ tag: 'circle', cx: '6', cy: '18', r: '3' },
			{ tag: 'circle', cx: '18', cy: '16', r: '3' },
		],
		browse: [
			{ tag: 'rect', x: '3', y: '3', width: '7', height: '7', rx: '1' },
			{ tag: 'rect', x: '14', y: '3', width: '7', height: '7', rx: '1' },
			{ tag: 'rect', x: '3', y: '14', width: '7', height: '7', rx: '1' },
			{ tag: 'rect', x: '14', y: '14', width: '7', height: '7', rx: '1' },
		],
		folder: [
			{ tag: 'path', d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' },
		],
		settings: [
			{ tag: 'path', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
			{ tag: 'path', d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z' },
		],
		'admin-settings': [
			{ tag: 'path', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z' },
			{ tag: 'path', d: 'm9 12 2 2 4-4' },
		],
		play: [
			{ tag: 'path', d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' },
		],
		pause: [
			{ tag: 'rect', x: '14', y: '3', width: '5', height: '18', rx: '1' },
			{ tag: 'rect', x: '5', y: '3', width: '5', height: '18', rx: '1' },
		],
		previous: [
			{ tag: 'path', d: 'M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z' },
			{ tag: 'path', d: 'M3 20V4' },
		],
		next: [
			{ tag: 'path', d: 'M21 4v16' },
			{ tag: 'path', d: 'M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z' },
		],
		'volume-high': [
			{ tag: 'path', d: 'M11 5 6 9H2v6h4l5 4V5Z' },
			{ tag: 'path', d: 'M15.54 8.46a5 5 0 0 1 0 7.07' },
			{ tag: 'path', d: 'M19.07 4.93a10 10 0 0 1 0 14.14' },
		],
		'volume-low': [
			{ tag: 'path', d: 'M11 5 6 9H2v6h4l5 4V5Z' },
			{ tag: 'path', d: 'M15.54 8.46a5 5 0 0 1 0 7.07' },
		],
		'volume-mute': [
			{ tag: 'path', d: 'M11 5 6 9H2v6h4l5 4V5Z' },
			{ tag: 'path', d: 'm22 9-6 6M16 9l6 6' },
		],
		queue: [
			{ tag: 'path', d: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
		],
		shuffle: [
			{ tag: 'path', d: 'm18 14 4 4-4 4' },
			{ tag: 'path', d: 'm18 2 4 4-4 4' },
			{ tag: 'path', d: 'M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22' },
			{ tag: 'path', d: 'M2 6h1.972a4 4 0 0 1 3.6 2.2' },
			{ tag: 'path', d: 'M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45' },
		],
		repeat: [
			{ tag: 'path', d: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3' },
		],
		'repeat-one': [
			{ tag: 'path', d: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3' },
			{ tag: 'path', d: 'M11 15V9' },
		],
		playlist: [
			{ tag: 'path', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
		],
		history: [
			{ tag: 'path', d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
			{ tag: 'path', d: 'M3 3v5h5' },
		],
		heart: [
			{ tag: 'path', d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' },
		],
		'heart-filled': [
			{ tag: 'path', d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z', fill: 'currentColor', stroke: 'none' },
		],
		'rotate-ccw': [
			{ tag: 'path', d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
			{ tag: 'path', d: 'M3 3v5h5' },
		],
		add: [
			{ tag: 'path', d: 'M12 5v14M5 12h14' },
		],
		close: [
			{ tag: 'path', d: 'M18 6 6 18M6 6l12 12' },
		],
		'arrow-up': [
			{ tag: 'path', d: 'M12 19V5' },
			{ tag: 'path', d: 'm5 12 7-7 7 7' },
		],
		'arrow-down': [
			{ tag: 'path', d: 'M12 5v14' },
			{ tag: 'path', d: 'm19 12-7 7-7-7' },
		],
		'chevron-up': [
			{ tag: 'path', d: 'm6 15 6-6 6 6' },
		],
		'circle-check': [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
			{ tag: 'path', d: 'm9 12 2 2 4-4' },
		],
		circle: [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
		],
		checkmark: [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
			{ tag: 'path', d: 'm9 12 2 2 4-4' },
		],
		'checkmark-outline': [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
		],
		'alert-triangle': [
			{ tag: 'path', d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' },
			{ tag: 'path', d: 'M12 9v4' },
			{ tag: 'path', d: 'M12 17h.01' },
		],
	};

	function appendSvgShapes(svg, shapes) {
		(shapes || []).forEach((spec) => {
			const node = document.createElementNS(SVG_NS, spec.tag);
			Object.entries(spec).forEach(([key, value]) => {
				if (key === 'tag') return;
				node.setAttribute(key, String(value));
			});
			svg.appendChild(node);
		});
	}

	function createSvg(name) {
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('class', 'ac-icon');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('focusable', 'false');
		appendSvgShapes(svg, ICON_SHAPES[name] || ICON_SHAPES.play);
		return svg;
	}

	function mount(parent, name) {
		if (!parent) return null;
		const svg = createSvg(name);
		const existing = parent.querySelector('.ac-icon');
		if (existing) {
			existing.replaceWith(svg);
		} else {
			parent.appendChild(svg);
		}
		return svg;
	}

	window.AudioCheckIcons = { createSvg, mount, appendSvgShapes, SVG_NS };
})();
