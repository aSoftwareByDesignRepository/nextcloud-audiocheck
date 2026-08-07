<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Exception;

/**
 * Optimistic-concurrency conflict (e.g. stale policyVersion).
 */
final class ConflictException extends AudioCheckException
{
}
