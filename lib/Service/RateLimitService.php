<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Service;

use OCA\AudioCheck\Exception\AccessDeniedException;
use OCA\AudioCheck\Exception\RateLimitExceededException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use Psr\Log\LoggerInterface;

/**
 * Sliding-window rate limiter backed by `ac_rate_limits` (shared DB = multi-node).
 *
 * Exclusive {@see ILockingProvider} lock serializes count→insert per (user, bucket)
 * so concurrent PHP-FPM / app-server workers cannot stampede past the quota
 * (unlike preference RMW or unlocked insert-then-count).
 *
 * Cover / CPU-heavy buckets fail closed if lock or bookkeeping is unavailable.
 */
class RateLimitService
{
	/**
	 * Lock paths land in oc_file_locks.key (VARCHAR(64)).
	 * Short prefix + md5(32) keeps every key ≤64.
	 */
	private const LOCK_PREFIX = 'ac-rl-';

	public function __construct(
		private IDBConnection $db,
		private ILockingProvider $locking,
		private LoggerInterface $logger,
	) {
	}

	public function assertAllowed(string $userId, string $action, int $max, int $windowSeconds): void
	{
		if ($userId === '') {
			throw new AccessDeniedException();
		}
		if (strlen($userId) > 64) {
			throw new AccessDeniedException();
		}

		$bucket = $this->normalizeBucket($action);
		$max = max(1, $max);
		$windowSeconds = max(1, $windowSeconds);
		$lockKey = self::LOCK_PREFIX . md5($userId . "\0" . $bucket);

		$acquired = false;
		try {
			$this->locking->acquireLock($lockKey, ILockingProvider::LOCK_EXCLUSIVE);
			$acquired = true;
		} catch (LockedException) {
			usleep(50_000);
			try {
				$this->locking->acquireLock($lockKey, ILockingProvider::LOCK_EXCLUSIVE);
				$acquired = true;
			} catch (LockedException) {
				$this->logger->warning('AudioCheck: rate-limit lock contested (fail-closed)', [
					'app' => 'audiocheck',
					'bucket' => $bucket,
				]);
				throw new RateLimitExceededException();
			}
		}

		try {
			$now = time();
			$cutoff = $now - $windowSeconds;

			// Opportunistic purge of this user's stale rows (keeps index small).
			$del = $this->db->getQueryBuilder();
			$del->delete('ac_rate_limits')
				->where($del->expr()->eq('bucket', $del->createNamedParameter($bucket)))
				->andWhere($del->expr()->eq('user_id', $del->createNamedParameter($userId)))
				->andWhere($del->expr()->lt('hit_at', $del->createNamedParameter($cutoff, IQueryBuilder::PARAM_INT)));
			$del->executeStatement();

			$qb = $this->db->getQueryBuilder();
			$qb->select($qb->func()->count('*', 'cnt'))
				->from('ac_rate_limits')
				->where($qb->expr()->eq('bucket', $qb->createNamedParameter($bucket)))
				->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
				->andWhere($qb->expr()->gte('hit_at', $qb->createNamedParameter($cutoff, IQueryBuilder::PARAM_INT)));
			$count = (int)$qb->executeQuery()->fetchOne();

			if ($count >= $max) {
				throw new RateLimitExceededException();
			}

			$ins = $this->db->getQueryBuilder();
			$ins->insert('ac_rate_limits')->values([
				'bucket' => $ins->createNamedParameter($bucket),
				'user_id' => $ins->createNamedParameter($userId),
				'hit_at' => $ins->createNamedParameter($now, IQueryBuilder::PARAM_INT),
			]);
			$ins->executeStatement();
		} catch (RateLimitExceededException $e) {
			throw $e;
		} catch (\Throwable $e) {
			$this->logger->error('AudioCheck: rate-limit bookkeeping failed (fail-closed)', [
				'app' => 'audiocheck',
				'bucket' => $bucket,
				'exception' => $e,
			]);
			throw new RateLimitExceededException();
		} finally {
			if ($acquired) {
				$this->locking->releaseLock($lockKey, ILockingProvider::LOCK_EXCLUSIVE);
			}
		}
	}

	private function normalizeBucket(string $action): string
	{
		$action = strtolower(trim($action));
		if ($action === '' || !preg_match('/^[a-z0-9_]{1,64}$/', $action)) {
			throw new AccessDeniedException();
		}
		return $action;
	}
}
