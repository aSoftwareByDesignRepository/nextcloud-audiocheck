#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Regenerate l10n/*.js from l10n/*.json (Nextcloud OC.L10N.register format).
 *
 * Emits the app's shipped three-argument form register(appId, map, pluralString)
 * — required by scripts/check-l10n-js-syntax.php.
 *
 * Usage: php scripts/regenerate-l10n-js.php
 */

$base = __DIR__ . '/../l10n';
$locales = array (
  0 => 'en',
  1 => 'de',
  2 => 'fr',
  3 => 'es',
  4 => 'da',
  5 => 'nl',
  6 => 'it',
  7 => 'pl',
  8 => 'sv',
  9 => 'nb',
  10 => 'pt_BR',
);

$plurals = array (
  'en' => 'nplurals=2; plural=(n != 1);',
  'de' => 'nplurals=2; plural=(n != 1);',
  'fr' => 'nplurals=2; plural=(n > 1);',
  'es' => 'nplurals=2; plural=(n != 1);',
  'da' => 'nplurals=2; plural=(n != 1);',
  'it' => 'nplurals=2; plural=(n != 1);',
  'nb' => 'nplurals=2; plural=(n != 1);',
  'nl' => 'nplurals=2; plural=(n != 1);',
  'pl' => 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  'pt_BR' => 'nplurals=2; plural=(n != 1);',
  'sv' => 'nplurals=2; plural=(n != 1);',
);

foreach ($locales as $lang) {
	$jsonPath = $base . '/' . $lang . '.json';
	$jsPath = $base . '/' . $lang . '.js';
	if (!is_file($jsonPath)) {
		fwrite(STDERR, "Missing: $jsonPath\n");
		exit(1);
	}
	$cat = json_decode((string)file_get_contents($jsonPath), true, 512, JSON_THROW_ON_ERROR);
	$translations = $cat['translations'] ?? [];

	$lines = ["OC.L10N.register(\n", "\t\"audiocheck\",\n", "\t{\n"];
	foreach ($translations as $key => $val) {
		$k = json_encode($key, JSON_UNESCAPED_UNICODE);
		if (is_array($val)) {
			$v = json_encode($val, JSON_UNESCAPED_UNICODE);
		} else {
			$v = json_encode((string)$val, JSON_UNESCAPED_UNICODE);
		}
		$lines[] = "\t" . $k . ' : ' . $v . ",\n";
	}
	$last = array_pop($lines);
	$last = rtrim($last, ",\n") . "\n";
	$lines[] = $last;
	$lines[] = "\t},\n";
	$lines[] = "\t" . json_encode($plurals[$lang]) . "\n";
	$lines[] = ");\n";
	file_put_contents($jsPath, implode('', $lines));
	echo "Wrote $jsPath (" . count($translations) . " keys)\n";
}

echo "l10n JS regeneration OK.\n";
