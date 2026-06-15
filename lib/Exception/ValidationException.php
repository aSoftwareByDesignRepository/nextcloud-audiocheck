<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Exception;

final class ValidationException extends \InvalidArgumentException
{
	/** @param array<string, mixed>|null $fields */
	public function __construct(
		string $message = 'invalid_input',
		int $code = 0,
		?\Throwable $previous = null,
		private readonly ?array $fields = null,
	) {
		parent::__construct($message, $code, $previous);
	}

	/** @return array<string, mixed>|null */
	public function getFields(): ?array
	{
		return $this->fields;
	}
}
