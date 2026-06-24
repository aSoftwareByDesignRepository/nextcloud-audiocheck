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

function checkDuplicateObjectShorthand(lines, file) {
	let depth = 0;
	let blockStart = -1;
	const methods = new Set();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (depth === 0 && /=\s*\{\s*$/.test(trimmed)) {
			blockStart = i;
			methods.clear();
			depth = 1;
			continue;
		}
		if (depth <= 0) continue;
		depth += (line.match(/\{/g) || []).length;
		depth -= (line.match(/\}/g) || []).length;
		const methodMatch = trimmed.match(/^(\w+)\s*\([^)]*\)\s*\{/);
		if (methodMatch) methods.add(methodMatch[1]);
		const shorthandMatch = trimmed.match(/^(\w+),$/);
		if (shorthandMatch && methods.has(shorthandMatch[1])) {
			errors.push(`${file}:${i + 1}: duplicate export "${shorthandMatch[1]}" — method already defined in same object`);
		}
		if (depth <= 0) {
			depth = 0;
			blockStart = -1;
			methods.clear();
		}
	}
}

function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full);
		else if (e.name.endsWith('.js')) check(full);
	}
}
function checkExportShorthands(content, file) {
	const exportMatch = content.match(/window\.AudioCheck\w+\s*=\s*\{([\s\S]*?)\n\t\};/);
	if (!exportMatch) return;
	const block = exportMatch[1];
	const names = [...block.matchAll(/^\t\t([A-Za-z_$][\w$]*),$/gm)].map((m) => m[1]);
	names.forEach((name) => {
		const defined = new RegExp(`function\\s+${name}\\s*\\(|const\\s+${name}\\s*=`).test(content);
		if (!defined) {
			errors.push(`${file}: export "${name}" is not defined in this file`);
		}
	});
}

function check(file) {
	const content = fs.readFileSync(file, 'utf8');
	const lines = content.split(/\r?\n/);
	lines.forEach((line, i) => {
		const s = line.replace(/\/\/.*$/, '');
		FORBIDDEN.forEach((r) => {
			if (r.pattern.test(s)) errors.push(`${file}:${i + 1}: ${r.message}`);
		});
	});
	checkDuplicateObjectShorthand(lines, file);
	if (file.endsWith('track-list-ui.js')) checkExportShorthands(content, file);
}
walk(JS_DIR);
if (errors.length) {
	errors.forEach((e) => console.error(e));
	process.exit(1);
}
console.log('frontend lint OK');
