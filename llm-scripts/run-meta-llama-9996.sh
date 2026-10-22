#!/usr/bin/env bash
# Copy to ~/LLM/scripts/ (chmod +x). Started on demand by llama-proxy (:9897 -> :9996).
set -euo pipefail

LLAMA_SERVER="${LLAMA_SERVER:-$HOME/LLM/llama.cpp/build/bin/llama-server}"
MODEL="${MODEL:-$HOME/.lmstudio/models/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf}"

CTX="${CTX:-32768}"
PORT="${PORT:-9996}"
KV_TYPE="${KV_TYPE:-q4_0}"
NBATCH="${NBATCH:-1024}"
UBATCH="${UBATCH:-256}"

[ -x "$LLAMA_SERVER" ] || {
    echo "llama-server tidak ditemukan: $LLAMA_SERVER"
    exit 1
}

[ -f "$MODEL" ] || {
    echo "model tidak ditemukan: $MODEL"
    exit 1
}

echo "========================================"
echo "Meta-Llama-3.1-8B-Instruct"
echo "role=worker-agent (database, ui/ux, qa, product manager)"
echo "model=$(basename "$MODEL")"
echo "ctx=$CTX"
echo "port=$PORT"
echo "kv=$KV_TYPE"
echo "batch=$NBATCH"
echo "ubatch=$UBATCH"
echo "========================================"

exec "$LLAMA_SERVER" \
    -m "$MODEL" \
    --alias meta-llama-3.1 \
    --host 172.18.0.1 \
    --port "$PORT" \
    --jinja \
    -fa on \
    -ngl 99 \
    -c "$CTX" \
    -b "$NBATCH" \
    -ub "$UBATCH" \
    -ctk "$KV_TYPE" \
    -ctv "$KV_TYPE" \
    --reasoning off \
    --temp 0.6 \
    --top-p 0.9 \
    --top-k 40 \
    --min-p 0.0 \
    --repeat-penalty 1.05 \
    --presence-penalty 0.0
