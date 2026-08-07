<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Source-level coverage for Library folder-name → content-kind guessing
 * (keeps the zero-modal add path honest without a browser).
 */
final class LibraryContentKindGuessContractTest extends TestCase
{
	private string $source;

	protected function setUp(): void
	{
		$this->source = (string)file_get_contents(dirname(__DIR__, 2) . '/js/views/library.js');
	}

	public function testGuessFunctionExistsAndCoversCommonNames(): void
	{
		$this->assertStringContainsString('function guessContentKindFromPath(path)', $this->source);
		$this->assertStringContainsString('audiobooks?', $this->source);
		$this->assertStringContainsString('hoerbuecher', $this->source);
		$this->assertStringContainsString('music|musik|musica|musique', $this->source);
		$this->assertMatchesRegularExpression('/return\s+[\'"]auto[\'"]/', $this->source);
	}

	public function testAddFlowResolvesKindWithoutModal(): void
	{
		$this->assertStringContainsString('resolveContentKind(presetKind, pick.pickedPath', $this->source);
		$this->assertStringNotContainsString('openModal', $this->source);
		$this->assertStringNotContainsString('What is in this folder?', $this->source);
	}

	public function testEmptyStateOffersTypedAddShortcuts(): void
	{
		$this->assertStringContainsString("t('audiocheck', 'Add music folder')", $this->source);
		$this->assertStringContainsString("t('audiocheck', 'Add audiobook folder')", $this->source);
		$this->assertStringContainsString("t('audiocheck', 'Add folder (auto-detect)')", $this->source);
		$this->assertStringContainsString(", 'music')", $this->source);
		$this->assertStringContainsString(", 'audiobook')", $this->source);
		$this->assertStringContainsString(", 'auto')", $this->source);
	}
}
