(function () {
	'use strict';

	const SVG_NS = 'http://www.w3.org/2000/svg';

	/** Keep in sync with {@see OCA\AudioCheck\Service\IconCatalog}. */
	const ICON_SHAPES = {
		play: [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
			{ tag: 'path', d: 'm10 8 6 4-6 4Z' },
		],
		pause: [
			{ tag: 'circle', cx: '12', cy: '12', r: '10' },
			{ tag: 'path', d: 'M10 8v8M14 8v8' },
		],
		previous: [
			{ tag: 'path', d: 'm12 8-6 4 6 4V8Z' },
			{ tag: 'path', d: 'M6 8v8' },
		],
		next: [
			{ tag: 'path', d: 'm12 16V8l6 4-6 4Z' },
			{ tag: 'path', d: 'M18 8v8' },
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
			{ tag: 'path', d: 'm16 3 5 5-5 5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5' },
		],
		repeat: [
			{ tag: 'path', d: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3' },
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
		svg.setAttribute('stroke-width', '1.75');
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
