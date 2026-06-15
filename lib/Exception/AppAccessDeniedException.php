<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Exception;

final class AppAccessDeniedException extends \RuntimeException
{
	public function __construct(
		string $message = 'app_access_denied',
		int $code = 0,
		?\Throwable $previous = null,
		private readonly string $denialReason = 'restriction',
	) {
		parent::__construct($message, $code, $previous);
	}

	public function getDenialReason(): string
	{
		return $this->denialReason;
	}
}
