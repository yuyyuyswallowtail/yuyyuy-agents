<?php
declare(strict_types=1);

/*
 * Resolves the sprint backlog: scope/sprints.json (grouping + order) x scope/<agent>.slices.json (content).
 * One sprint = one feature handled to completion by every role that has a part in it.
 * Prints a JSON array on stdout:
 *   [{"id","title","brief","parts":[{"key","role","slice","title","brief","check"}]}]
 * Part order inside a sprint is the declared role order: database, backend, uiux, frontend, qa.
 * usage: php sprints.php [scope dir]
 */

const ROLE_ORDER = ['database', 'backend', 'uiux', 'frontend', 'qa'];
// roles that have no slice file of their own read the file of the agent they hand off to / are built on
const SLICE_FILE = ['database' => 'backend', 'backend' => 'backend', 'uiux' => 'frontend', 'frontend' => 'frontend', 'qa' => 'qa'];

function bail(string $m): never
{
    fwrite(STDERR, "sprints.php: $m\n");
    exit(1);
}

$scope = rtrim($argv[1] ?? dirname(__DIR__) . '/scope', '/');
$read = static function (string $f): array {
    $j = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    return is_array($j) ? $j : bail("cannot read JSON: $f");
};

$slices = [];
foreach (array_unique(array_values(SLICE_FILE)) as $file) {
    foreach ($read("$scope/$file.slices.json") as $s) {
        $slices[$file][(string) ($s['id'] ?? '')] = $s;
    }
}

$out = [];
$seen = [];
$owners = [];
foreach ($read("$scope/sprints.json") as $sp) {
    $id = (string) ($sp['id'] ?? '');
    if (preg_match('/^[0-9]{2}[A-Z]?-[a-z0-9-]+$/', $id) !== 1) {
        bail("invalid sprint id: $id");
    }
    if (isset($seen[$id])) {
        bail("duplicate sprint id: $id");
    }
    $seen[$id] = true;
    $parts = [];
    foreach (ROLE_ORDER as $role) {
        foreach ((array) ($sp['parts'][$role] ?? []) as $sliceId) {
            $def = $slices[SLICE_FILE[$role]][(string) $sliceId] ?? bail("sprint $id: unknown slice '$sliceId' for role $role");
            $ownerKey = in_array($role, ['database', 'backend'], true) ? "impl:$sliceId" : "$role:$sliceId";
            if (isset($owners[$ownerKey])) {
                bail("slice '$sliceId' ($role) is assigned twice: {$owners[$ownerKey]} and $id");
            }
            $owners[$ownerKey] = $id;
            $parts[] = ['key' => "$role:$sliceId", 'role' => $role, 'slice' => (string) $sliceId,
                'title' => (string) ($def['title'] ?? $sliceId), 'brief' => (string) ($def['brief'] ?? ''), 'check' => $def['check'] ?? []];
        }
    }
    if ($parts === []) {
        bail("sprint $id has no parts");
    }
    $lead = null;
    foreach ($parts as $p) {
        if ($p['slice'] === $id) {
            $lead = $p;
            break;
        }
    }
    $lead ??= $parts[0];
    $out[] = ['id' => $id, 'title' => $lead['title'], 'brief' => $lead['brief'], 'parts' => $parts];
}

// every backend/frontend/qa slice must belong to some sprint, otherwise it silently never runs
foreach ($slices as $file => $defs) {
    foreach (array_keys($defs) as $sliceId) {
        $key = $file === 'backend' ? "impl:$sliceId" : (($file === 'frontend') ? "frontend:$sliceId" : "qa:$sliceId");
        if (!isset($owners[$key])) {
            bail("slice '$sliceId' ($file) is not assigned to any sprint");
        }
    }
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
