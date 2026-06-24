<?php

declare(strict_types=1);

$nextcloudRoot = getenv('NEXTCLOUD_ROOT') ?: '';
$candidates = [];
if ($nextcloudRoot !== '') {
	$candidates[] = rtrim($nextcloudRoot, '/\\') . '/lib/base.php';
}
$candidates[] = __DIR__ . '/../../lib/base.php';
$candidates[] = __DIR__ . '/../../../lib/base.php';

$base = null;
foreach ($candidates as $candidate) {
	if (is_file($candidate)) {
		$base = $candidate;
		break;
	}
}

if ($base === null && !interface_exists('OC\Hooks\Emitter')) {
	eval('namespace OC\Hooks { interface Emitter {} }');
}

if ($base !== null) {
	require_once $base;
	$integrationBootstrap = dirname(__DIR__, 3) . '/scripts/phpunit-integration-bootstrap.php';
	if (is_file($integrationBootstrap)) {
		require_once $integrationBootstrap;
	}
}

/** @var \Composer\Autoload\ClassLoader $loader */
$loader = require __DIR__ . '/../vendor/autoload.php';

// When Nextcloud is bootstrapped, drop OCP/NCU stubs so real server interfaces win.
if ($base !== null) {
	$loader->setPsr4('OCP\\', []);
	$loader->setPsr4('NCU\\', []);
}

if (!class_exists(\Test\TestCase::class)) {
	$shim = __DIR__ . '/shim/TestCase.php';
	if (is_file($shim)) {
		require_once $shim;
	}
}

if ($base === null && !class_exists(\Symfony\Component\Console\Command\Command::class, false)) {
	eval('namespace Symfony\Component\Console\Command; class Command {}');
}

if ($base === null) {
	if (!class_exists(\Doctrine\DBAL\ParameterType::class)) {
		eval('namespace Doctrine\\DBAL; final class ParameterType { public const NULL = 0; public const INTEGER = 1; public const STRING = 2; public const LARGE_OBJECT = 3; }');
	}
	if (!class_exists(\Doctrine\DBAL\ArrayParameterType::class)) {
		eval('namespace Doctrine\\DBAL; final class ArrayParameterType { public const INTEGER = 1; public const STRING = 2; public const ASCII = 3; public const BINARY = 4; }');
	}
	if (!class_exists(\Doctrine\DBAL\Connection::class)) {
		eval('namespace Doctrine\\DBAL; class Connection {}');
	}
	if (!class_exists(\Doctrine\DBAL\Types\Types::class)) {
		eval("namespace Doctrine\\DBAL\\Types; final class Types { public const BOOLEAN = 'boolean'; public const DATETIME_MUTABLE = 'datetime'; public const TIME_MUTABLE = 'time'; public const DATE_MUTABLE = 'date'; public const DATE_IMMUTABLE = 'date_immutable'; public const DATETIME_IMMUTABLE = 'datetime_immutable'; public const DATETIMETZ_MUTABLE = 'datetimetz'; public const DATETIMETZ_IMMUTABLE = 'datetimetz_immutable'; public const BIGINT = 'bigint'; public const BINARY = 'binary'; public const BLOB = 'blob'; public const DATEINTERVAL = 'dateinterval'; public const DECIMAL = 'decimal'; public const FLOAT = 'float'; public const GUID = 'guid'; public const JSON = 'json'; public const SIMPLE_ARRAY = 'simple_array'; public const SMALLFLOAT = 'smallfloat'; public const SMALLINT = 'smallint'; public const STRING = 'string'; public const TEXT = 'text'; }");
	}
	if (!class_exists(\Doctrine\DBAL\Query\Expression\ExpressionBuilder::class)) {
		eval('namespace Doctrine\\DBAL\\Query\\Expression; final class ExpressionBuilder { public const EQ = \'=\'; public const NEQ = \'<>\'; public const LT = \'<\'; public const LTE = \'<=\'; public const GT = \'>\'; public const GTE = \'>=\'; }');
	}
}
