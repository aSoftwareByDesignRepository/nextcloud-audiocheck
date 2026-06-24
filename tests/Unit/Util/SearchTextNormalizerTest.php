<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Tests\Unit\Util;

use OCA\AudioCheck\Util\SearchTextNormalizer;
use PHPUnit\Framework\TestCase;

final class SearchTextNormalizerTest extends TestCase
{
	public function testLowercasesAndTrims(): void
	{
		$this->assertSame('hello world', SearchTextNormalizer::normalize('  Hello World  '));
	}

	public function testFoldsDiacritics(): void
	{
		$this->assertSame('motorhead', SearchTextNormalizer::normalize('Motörhead'));
		$this->assertSame('beyonce', SearchTextNormalizer::normalize('Beyoncé'));
		$this->assertSame('uber grosse', SearchTextNormalizer::normalize('Über Größe'));
	}

	public function testExpandsGermanSharpS(): void
	{
		$this->assertSame('strasse', SearchTextNormalizer::normalize('Straße'));
	}

	public function testCollapsesPunctuation(): void
	{
		$this->assertSame('ac dc', SearchTextNormalizer::normalize('AC/DC'));
		$this->assertSame('i robot', SearchTextNormalizer::normalize('I, Robot'));
	}

	public function testNullishInput(): void
	{
		$this->assertNull(SearchTextNormalizer::normalize(null));
		$this->assertNull(SearchTextNormalizer::normalize(''));
		$this->assertNull(SearchTextNormalizer::normalize('   '));
	}

	public function testTokenizeDedupesAndCaps(): void
	{
		$this->assertSame(['the', 'beatles'], SearchTextNormalizer::tokenize('the the beatles'));
		$this->assertSame([], SearchTextNormalizer::tokenize('   '));
		$this->assertSame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], SearchTextNormalizer::tokenize('a b c d e f g h i j', 8));
	}

	public function testQueryAccentMatchesStoredAccentForm(): void
	{
		$stored = SearchTextNormalizer::normalize('Motörhead');
		$queryToken = SearchTextNormalizer::tokenize('motorhead')[0] ?? '';
		$this->assertSame('motorhead', $stored);
		$this->assertSame('motorhead', $queryToken);
		$this->assertNotFalse(str_contains($stored, $queryToken));
	}
}
