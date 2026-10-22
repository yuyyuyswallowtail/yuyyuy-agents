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

Port: DeepSeek 9999 (proxy 9899), Qwen 9998 (9898), Meta-Llama 9996 (9897), Ministral 9997 (tanpa proxy).

## Tes

- `python3 -I test/proxy.sim.py`: tidak pernah ada dua model berat berjalan bersamaan.
- `node test/scrum.sim.js`: engine asli + skrip asli + repo git sementara, LLM dipalsukan (butuh bash, php, git).
