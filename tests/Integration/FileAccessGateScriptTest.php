<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Integration;

use PHPUnit\Framework\TestCase;

/** Ensures the static AC-FA gate script stays green. */
final class FileAccessGateScriptTest extends TestCase
{
	public function testFileAccessGateScriptPasses(): void
	{
		$script = dirname(__DIR__, 2) . '/scripts/check-file-access-gate.sh';
		$this->assertFileExists($script);
		$output = [];
		$code = 0;
		exec('bash ' . escapeshellarg($script) . ' 2>&1', $output, $code);
		$this->assertSame(0, $code, implode("\n", $output));
		$this->assertStringContainsString('File-access gate OK', implode("\n", $output));
	}

	public function testNoOutboundHttpGateScriptPasses(): void
	{
		$script = dirname(__DIR__, 2) . '/scripts/check-no-outbound-http.sh';
		$this->assertFileExists($script);
		$output = [];
		$code = 0;
		exec('bash ' . escapeshellarg($script) . ' 2>&1', $output, $code);
		$this->assertSame(0, $code, implode("\n", $output));
		$this->assertStringContainsString('No-outbound gate OK', implode("\n", $output));
	}
}
