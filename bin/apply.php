<?php
declare(strict_types=1);

/*
 * Safe applier for executor output. Reads base64 JSON from stdin, prints JSON.
 *   php apply.php docs   {root, agent, slice, md, tasks}   agent: backend|frontend|qa|database|uiux|pm (pm: tasks optional)
 *   php apply.php files  {root, files:[{path,content}], checks:[cmd]}
 */

const MAX_FILE_BYTES = 200000;
const DENY = ['/.git/', '/vendor/', '/node_modules/', '/.claude/', '/storage/framework/'];
const CHECKS = [
    '#^php artisan test( --compact)?( --filter=[\w\\\\:.-]+)?( [\w/.-]+)?$#',
    '#^vendor/bin/pest( [\w/.=-]+)*$#',
    '#^vendor/bin/pint( --test| --dirty)?( /[\w/.-]+)*$#',
    '#^php -l /[\w/.-]+$#',
    '#^php artisan (route:list|migrate:status)( --[\w=-]+)*$#',
    '#^npm run (build|lint)$#',
    '#^composer (validate|dump-autoload)$#',
];

function out(array $data, int $code = 0): never
{
    fwrite(STDOUT, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
    exit($code);
}

function fail(string $message): never
{
    out(['ok' => false, 'error' => $message], 1);
}

function safePath(string $root, string $path): ?string
{
    if ($path === '' || $path[0] !== '/' || str_contains($path, "\0")) {
        return null;
    }
    foreach (explode('/', $path) as $seg) {
        if ($seg === '..' || $seg === '.') {
            return null;
        }
    }
    if (!str_starts_with($path, $root . '/')) {
        return null;
    }
    foreach (DENY as $d) {
        if (str_contains($path, $d)) {
            return null;
        }
    }
    $base = basename($path);
    if ($base === '.env' || str_starts_with($base, '.env.') && $base !== '.env.example') {
        return null;
    }
    return $path;
}

function writeFile(string $path, string $content): void
{
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException("cannot create $dir");
    }
    if (file_put_contents($path, $content) === false) {
        throw new RuntimeException("cannot write $path");
    }
}

function runCheck(string $root, string $cmd): array
{
    $allowed = false;
    foreach (CHECKS as $re) {
        if (preg_match($re, $cmd) === 1) {
            $allowed = true;
            break;
        }
    }
    if (!$allowed) {
        return ['cmd' => $cmd, 'code' => 126, 'out' => 'rejected: command not in whitelist'];
    }
    $proc = proc_open(['timeout', '600', 'sh', '-c', $cmd], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $root);
    if (!is_resource($proc)) {
        return ['cmd' => $cmd, 'code' => 127, 'out' => 'cannot start process'];
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($proc);
    $text = trim($stdout . "\n" . $stderr);
    return ['cmd' => $cmd, 'code' => $code, 'out' => strlen($text) > 3000 ? '...' . substr($text, -3000) : $text];
}

$mode = $argv[1] ?? '';
$raw = base64_decode(trim((string) stream_get_contents(STDIN)), true);
$in = $raw === false ? null : json_decode($raw, true);
if (!is_array($in)) {
    fail('invalid payload');
}
$root = rtrim((string) ($in['root'] ?? ''), '/');
if ($root === '' || $root[0] !== '/' || !is_dir($root)) {
    fail('root must be an existing absolute path');
}

if ($mode === 'docs') {
    $agent = (string) ($in['agent'] ?? '');
    $slice = (string) ($in['slice'] ?? '');
    if (!in_array($agent, ['backend', 'frontend', 'qa', 'database', 'uiux', 'pm'], true) || preg_match('/^[A-Za-z0-9-]+$/', $slice) !== 1) {
        fail('invalid agent or slice');
    }
    $dir = "$root/docs/agents/$agent";
    $md = "$dir/$slice.md";
    $tasks = "$dir/$slice.tasks.json";
    try {
        writeFile($md, (string) ($in['md'] ?? '') . "\n");
        if (($in['tasks'] ?? null) !== null || $agent !== 'pm') {
            writeFile($tasks, json_encode($in['tasks'] ?? [], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        }
    } catch (Throwable $e) {
        fail($e->getMessage());
    }
    out(['ok' => true, 'path' => $md, 'tasks_path' => $tasks]);
}

if ($mode === 'files') {
    $written = [];
    $rejected = [];
    foreach ((array) ($in['files'] ?? []) as $f) {
        $path = safePath($root, (string) ($f['path'] ?? ''));
        $content = (string) ($f['content'] ?? '');
        if ($path === null) {
            $rejected[] = ['path' => (string) ($f['path'] ?? ''), 'reason' => 'path must be absolute, inside the repo root, and not protected'];
            continue;
        }
        if (strlen($content) > MAX_FILE_BYTES) {
            $rejected[] = ['path' => $path, 'reason' => 'file too large'];
            continue;
        }
        try {
            writeFile($path, rtrim($content) . "\n");
            $written[] = $path;
        } catch (Throwable $e) {
            $rejected[] = ['path' => $path, 'reason' => $e->getMessage()];
        }
    }
    $checks = [];
    foreach (array_slice((array) ($in['checks'] ?? []), 0, 6) as $cmd) {
        $checks[] = runCheck($root, (string) $cmd);
    }
    out(['ok' => true, 'written' => $written, 'rejected' => $rejected, 'checks' => $checks]);
}

fail('unknown mode');
