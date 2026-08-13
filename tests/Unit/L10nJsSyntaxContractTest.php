<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Browser loads l10n/*.js as classic scripts (OC.L10N.register).
 * A broken third argument (e.g. `"pluralForm": "..."`) throws
 * SyntaxError: missing ) after argument list and pollutes every NC page console.
 */
final class L10nJsSyntaxContractTest extends TestCase
{
	private string $root;

	protected function setUp(): void
	{
		$this->root = dirname(__DIR__, 2);
	}

	public function testLocaleJsFilesAreValidOcL10nRegisterCalls(): void
	{
		$dir = $this->root . '/l10n';
		$files = glob($dir . '/*.js') ?: [];
		$this->assertNotEmpty($files, 'expected l10n/*.js');

		foreach ($files as $path) {
			$src = (string)file_get_contents($path);
			$base = basename($path);
			$this->assertStringContainsString('OC.L10N.register(', $src, $base);
			$this->assertDoesNotMatchRegularExpression(
				'/["\']pluralForm["\']\s*:/',
				$src,
				$base . ' must not use a pluralForm object key — third register() arg is the plural string',
			);
			$this->assertMatchesRegularExpression(
				'/\},\s*"nplurals=\d+;\s*plural=\([^"]+\)\s*;"\s*\)\s*;\s*$/',
				$src,
				$base . ' must end with OC.L10N.register(app, translations, "nplurals=…; plural=(…);");',
			);
			$this->assertTrue(
				self::jsStringAwareParenBalanceOk($src),
				$base . ' has unbalanced () outside of string literals',
			);
		}

		// Host/CI with Node: same engine family as Chromium.
		if (self::nodeAvailable()) {
			foreach ($files as $path) {
				$base = basename($path);
				$cmd = 'node -e ' . escapeshellarg(
					'try { new Function(require("fs").readFileSync(process.argv[1], "utf8")); }'
					. ' catch (e) { console.error(e.message); process.exit(1); }'
				) . ' ' . escapeshellarg($path);
				exec($cmd . ' 2>&1', $out, $code);
				$this->assertSame(0, $code, $base . ' failed JS parse: ' . implode("\n", $out));
			}
		}
	}

	private static function nodeAvailable(): bool
	{
		exec('command -v node 2>/dev/null', $out, $code);

		return $code === 0 && ($out[0] ?? '') !== '';
	}

	/**
	 * Minimal string-aware () balance check — catches the classic
	 * `}, "pluralForm" : "…");` footgun without requiring Node in Docker.
	 */
	private static function jsStringAwareParenBalanceOk(string $src): bool
	{
		$depth = 0;
		$len = strlen($src);
		$inString = false;
		$escape = false;
		for ($i = 0; $i < $len; $i++) {
			$ch = $src[$i];
			if ($inString) {
				if ($escape) {
					$escape = false;
					continue;
				}
				if ($ch === '\\') {
					$escape = true;
					continue;
				}
				if ($ch === '"') {
					$inString = false;
				}
				continue;
			}
			if ($ch === '"') {
				$inString = true;
				continue;
			}
			if ($ch === '(') {
				$depth++;
			} elseif ($ch === ')') {
				$depth--;
				if ($depth < 0) {
					return false;
				}
			}
		}

		return !$inString && $depth === 0;
	}
}
