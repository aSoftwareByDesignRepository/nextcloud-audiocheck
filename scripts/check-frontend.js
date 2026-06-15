#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const FORBIDDEN = [
	{ pattern: /\.innerHTML\s*=\s*(?!['"]\s*['"]\s*[;,)])/u, message: 'innerHTML assignment forbidden' },
	{ pattern: /\beval\s*\(/u, message: 'eval forbidden' },
];
const errors = [];
function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full);
		else if (e.name.endsWith('.js')) check(full);
	}
}
function check(file) {
	const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
	lines.forEach((line, i) => {
		const s = line.replace(/\/\/.*$/, '');
		FORBIDDEN.forEach((r) => {
			if (r.pattern.test(s)) errors.push(`${file}:${i + 1}: ${r.message}`);
		});
	});
}
walk(JS_DIR);
if (errors.length) {
	errors.forEach((e) => console.error(e));
	process.exit(1);
}
console.log('frontend lint OK');
