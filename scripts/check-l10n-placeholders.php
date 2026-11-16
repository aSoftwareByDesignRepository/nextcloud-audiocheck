<?php

declare(strict_types=1);

$en = json_decode((string)file_get_contents(__DIR__ . '/../l10n/en.json'), true, 512, JSON_THROW_ON_ERROR);
foreach ($en['translations'] ?? [] as $key => $val) {
	foreach (is_array($val) ? $val : [$val] as $form) {
		if (preg_match('/\{[^}]+\}/', $key) !== preg_match('/\{[^}]+\}/', (string)$form)) {
			fwrite(STDERR, "Placeholder mismatch: $key\n");
			exit(1);
		}
	}
}
echo "l10n placeholders OK\n";
