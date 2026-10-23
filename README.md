# yuyyuy-agents

Pipeline n8n yang membangun proyek Laravel (yuyyuy-admin-web) dengan model lokal llama.cpp. Dua mode, dipilih lewat `cfg.scrum.enabled` di node Config:

- **scrum (default)**: satu sprint = satu fitur, dikerjakan sampai selesai, baru lanjut ke sprint berikutnya.
- **legacy**: alur lama backend > frontend > qa (`"scrum": {"enabled": false}`), tidak berubah.

## Peran dan model (hanya SATU model berat aktif; Ministral selalu hidup)

| Peran | Merencanakan | Menulis | Serah-terima |
|---|---|---|---|
| database | DeepSeek | Meta-Llama | kontrak skema dipakai backend |
| backend | DeepSeek | Qwen2.5-Coder | |
| ui/ux | DeepSeek | Meta-Llama | spek desain dipakai frontend |
| frontend | DeepSeek | Qwen2.5-Coder | |
| qa | DeepSeek | Meta-Llama | cacat kembali ke frontend/backend |
| product manager | DeepSeek (gate, final) | Meta-Llama (kickoff, retro) | memicu sprint berikutnya |

Ministral (:9997) mencatat setiap interaksi ke SQLite (`bin/migrations/001_conversations.sql`, satu percakapan per sprint).

## Alur satu sprint

1. KICKOFF (PM/Llama): tujuan + kriteria penerimaan per peran.
2. Loop planning (DeepSeek): tiap bagian direncanakan, lalu GATE PM `APPROVE/REJECT`. Maksimum 3 iterasi; hanya peran yang disebut PM yang merencanakan ulang. Setelah 3 kali REJECT sprint BLOCKED dan diparkir di `wip/<id>-<waktu>` (run berhenti, `onBlocked: continue` untuk lanjut).
3. Implementasi: penulis dikelompokkan per model (Llama: database, uiux; Qwen: backend, frontend; Llama: qa) supaya swap model minimal.
4. Bukti QA (`bin/qa-tools.sh`): pint, larastan/phpstan, `php artisan test` (Pest, termasuk arch test), composer audit, hygiene; opsional `pest --mutate`.
5. FINAL (PM/DeepSeek). Alat blocking yang gagal memaksa REJECT walau PM menyetujui; cacat jadi tugas perbaikan (maks 2 putaran).
6. RETRO + pemicu scrum berikutnya (PM/Llama), dokumen `docs/agents/pm/<sprint>.md`, lalu `feat/<id>` di-push (tidak pernah ke main).

Markdown hanya dibuat untuk sprint yang sedang berjalan.

## Pengetahuan dependency yang lebih baru dari data latih model

Urutan kebenaran: VERIFIED FACTS > SKILLS (Boost) > DEPS + `scope/rules/` > ingatan model.
`bin/deps.sh` memberi versi terpasang; model yang ragu menulis `<<<PROBE>>>` dan engine menjawab dari kode terpasang (`bin/probe.sh`: refleksi, grep vendor, UPGRADE.md); larastan menangkap API yang tidak ada. Kaidah yang hilang muncul sebagai `GAP` di dokumen PM untuk ditinjau lalu dipromosikan ke `scope/rules/`.

## Deploy

1. Salin repo ke `~/n8n/workspace/_agents` (terlihat sebagai `/workspace/_agents` di container).
2. `cp llm-scripts/run-meta-llama-9996.sh ~/LLM/scripts/ && chmod +x ~/LLM/scripts/run-meta-llama-9996.sh`
3. `cp systemd/llama-meta-llama.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user restart llama-proxy`
4. Pastikan `sqlite3`, `php`, `git` ada di tempat node Exec berjalan; jalankan sekali `bash bin/mem.sh migrate`.
5. `python3 sync-engine.py` lalu import workflow (atau `apply-v2.py` untuk workflow gabungan), lalu `apply-proxy.py` agar node memakai port proxy.

Port: DeepSeek 9999 (proxy 9899), Qwen 9998 (9898), Meta-Llama 9996 (9897), Gemma 3 vision 9995 (9896), Ministral 9997 (tanpa proxy).

Context (`-c`) di skrip run: DeepSeek 65536, Qwen2.5-Coder 65536, Meta-Llama 49152, Ministral 49152, Gemma 3 16384. Ubah lewat variabel `CTX` atau baris `CTX="${CTX:-...}"` di skrip.

## Gerbang QA (diperluas)

`bin/qa-tools.sh` menghasilkan satu blok per alat; alat yang memblokir dan gagal memaksa PM menolak, lalu cacatnya menjadi tugas perbaikan untuk penulis peran yang memiliki file itu.

| Blok | Memblokir | Isi |
|---|---|---|
| pint, phpstan, tests, audit | pint/tests ya; phpstan ya bila ada `phpstan.neon`; audit tidak | seperti sebelumnya |
| tests-added | ya | kode Service/Repository/DTO/Validator/Policy/Support/Job/Controller/Livewire berubah tetapi tidak ada file tes yang berubah; baris keluaran menyebut file tes yang harus dibuat (ditulis penulis qa) |
| css | ya | custom property di luar aturan, path filesystem di `url()`, rentang `24-32px`, kurung tidak seimbang (`bin/css-check.js`) |
| security | fungsi berbahaya ya; pola berisiko tidak | `eval/unserialize/exec...` memblokir; `{!! !!}`, raw SQL dengan variabel, mass assignment dari seluruh request jadi saran untuk PM |
| mutation | tidak | `pest --mutate` otomatis bila ada pcov/xdebug (`qaMutation`: `"auto"`, `true`, `false`) |
| e2e | tidak (atur `e2eBlocking: true`) | Playwright, otomatis bila sudah dipasang |

Selain itu perencana backend/frontend wajib menyertakan satu task tes (`requireTests`); rencana tanpa tes diminta direvisi (maks. `maxRev`), dan sisanya terlihat oleh gate PM.

### Playwright dengan user uji per role

```bash
bash bin/e2e-scaffold.sh /workspace/yuyyuy-admin-web --install   # sekali per proyek; tidak menimpa file yang ada
```
Menambah `playwright.config.ts`, `tests/e2e/` (fixtures, global-setup, `rbac.spec.ts`, `access-matrix.json`) dan `database/seeders/E2eUsersSeeder.php`: satu user per role Spatie (`e2e-<role>@example.test`, hanya di local/testing) dengan database SQLite terpisah (`database/e2e.sqlite`). Sprint `08-e2e-playwright` meminta agen qa melengkapi matriks akses (semua route x semua role + tamu) dan alur utama per role. Tangkapan layar tersimpan di `storage/e2e-screens/` untuk ditinjau (nanti oleh model vision).

## Review visual (Gemma 3)

Model ke-5, `gemma-3-4b-it` + `mmproj` (`llm-scripts/run-gemma3-9995.sh`, unit `llama-gemma3.service`), ikut bergantian lewat proxy (satu model berat pada satu waktu). Setelah bukti QA, bila ada tangkapan layar Playwright dari 6 jam terakhir (`storage/e2e-screens/*.jpg|png`, maks. 3, file di atas 450 KB dilewati), `bin/shots.php` mengirimnya ke Gemma bersama spesifikasi desain sprint; temuannya (`ISSUE <file>: ...`) menjadi blok `vision` yang bersifat saran untuk PM FINAL. Tanpa tangkapan layar, Gemma tidak pernah dimuat. Matikan dengan `"vision": false` di Config.

## Tes

- `python3 -I test/proxy.sim.py`: tidak pernah ada dua model berat berjalan bersamaan.
- `node test/scrum.sim.js`: engine asli + skrip asli + repo git sementara, LLM dipalsukan (butuh bash, php, git).
