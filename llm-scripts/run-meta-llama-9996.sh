#!/usr/bin/env bash
# Copy to ~/LLM/scripts/ (chmod +x). Started on demand by llama-proxy (:9897 -> :9996).
set -euo pipefail

LLAMA_SERVER="${LLAMA_SERVER:-$HOME/LLM/llama.cpp/build/bin/llama-server}"
MODEL="${MODEL:-$HOME/.lmstudio/models/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf}"

CTX="${CTX:-49152}"
PORT="${PORT:-9996}"
KV_TYPE="${KV_TYPE:-q4_0}"
# The GGUF's own template made Llama 3.1 answer plain prompts with tool-call JSON, and in recent llama.cpp
# builds "--chat-template llama3" is taken as literal template text (the prompt collapses to 4 tokens).
# A plain Llama 3 template file keeps the format exact and adds no tool instructions.
TEMPLATE_FILE="${TEMPLATE_FILE:-$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/llama3.jinja}"
NBATCH="${NBATCH:-1024}"
UBATCH="${UBATCH:-256}"

[ -x "$LLAMA_SERVER" ] || {
    echo "llama-server tidak ditemukan: $LLAMA_SERVER"
    exit 1
}

[ -f "$TEMPLATE_FILE" ] || {
    echo "template tidak ditemukan: $TEMPLATE_FILE (salin llm-scripts/llama3.jinja ke folder yang sama)"
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
echo "template=$TEMPLATE_FILE"
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
    --chat-template-file "$TEMPLATE_FILE" \
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
