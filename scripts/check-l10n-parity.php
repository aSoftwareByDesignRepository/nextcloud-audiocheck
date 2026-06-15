<?php

declare(strict_types=1);

$base = __DIR__ . '/../l10n';
$en = json_decode((string)file_get_contents($base . '/en.json'), true, 512, JSON_THROW_ON_ERROR);
$de = json_decode((string)file_get_contents($base . '/de.json'), true, 512, JSON_THROW_ON_ERROR);
$enKeys = array_keys($en['translations'] ?? []);
$deKeys = array_keys($de['translations'] ?? []);
sort($enKeys);
sort($deKeys);
if ($enKeys !== $deKeys) {
	fwrite(STDERR, "EN/DE l10n key mismatch\n");
	exit(1);
}
echo "l10n parity OK\n";
