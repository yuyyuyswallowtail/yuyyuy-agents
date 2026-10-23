<?php
declare(strict_types=1);

/*
 * Newest E2E screenshots as JSON for the vision review (gemma3).
 *   php shots.php <root> [max=3] [maxBytes=450000] [maxAgeSeconds=21600]
 * Prints [{"path": "storage/e2e-screens/x.jpg", "mime": "image/jpeg", "b64": "..."}] ([] when there is nothing to review).
 * Oversized files are skipped, so one big full-page PNG cannot blow up the request.
 */

$root = rtrim((string) ($argv[1] ?? ''), '/');
$max = max(1, min(6, (int) ($argv[2] ?? 3)));
$maxBytes = max(10000, (int) ($argv[3] ?? 450000));
$maxAge = max(60, (int) ($argv[4] ?? 21600));

if ($root === '' || $root[0] !== '/' || !is_dir($root)) {
    fwrite(STDERR, "root must be an existing absolute path\n");
    echo "[]\n";
    exit(0);
}

$files = [];
foreach (glob("$root/storage/e2e-screens/*.{jpg,jpeg,png}", GLOB_BRACE) ?: [] as $f) {
    $t = filemtime($f);
    if ($t !== false && $t >= time() - $maxAge && filesize($f) <= $maxBytes) {
        $files[$f] = $t;
    }
}
arsort($files);

$out = [];
foreach (array_slice(array_keys($files), 0, $max) as $f) {
    $data = file_get_contents($f);
    if ($data === false) {
        continue;
    }
    $out[] = [
        'path' => 'storage/e2e-screens/' . basename($f),
        'mime' => str_ends_with(strtolower($f), '.png') ? 'image/png' : 'image/jpeg',
        'b64' => base64_encode($data),
    ];
}
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
