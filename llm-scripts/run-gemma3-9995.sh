#!/usr/bin/env bash
# Copy to ~/LLM/scripts/ (chmod +x). Started on demand by llama-proxy (:9896 -> :9995).
# Gemma 3 4B with its vision projector: reads screenshots and web designs (OpenAI-style image_url messages).
set -euo pipefail

LLAMA_SERVER="${LLAMA_SERVER:-$HOME/LLM/llama.cpp/build/bin/llama-server}"
DIR="${DIR:-$HOME/.lmstudio/models/lmstudio-community/gemma-3-4b-it-GGUF}"
MODEL="${MODEL:-$DIR/gemma-3-4b-it-Q4_K_M.gguf}"
MMPROJ="${MMPROJ:-$DIR/mmproj-model-f16.gguf}"

CTX="${CTX:-16384}"
PORT="${PORT:-9995}"
KV_TYPE="${KV_TYPE:-q8_0}"
NBATCH="${NBATCH:-1024}"
UBATCH="${UBATCH:-512}"

[ -x "$LLAMA_SERVER" ] || { echo "llama-server tidak ditemukan: $LLAMA_SERVER"; exit 1; }
[ -f "$MODEL" ] || { echo "model tidak ditemukan: $MODEL"; exit 1; }
[ -f "$MMPROJ" ] || { echo "mmproj tidak ditemukan: $MMPROJ"; exit 1; }

echo "========================================"
echo "Gemma-3-4B-it (vision)"
echo "role=vision-reviewer (screenshots, user web designs)"
echo "model=$(basename "$MODEL")"
echo "mmproj=$(basename "$MMPROJ")"
echo "ctx=$CTX"
echo "port=$PORT"
echo "========================================"

# One slot: images are large and only one request runs at a time.
exec "$LLAMA_SERVER" \
    -m "$MODEL" \
    --mmproj "$MMPROJ" \
    --alias gemma3-vision \
    --host 172.18.0.1 \
    --port "$PORT" \
    --jinja \
    -fa on \
    -ngl 99 \
    -np 1 \
    -c "$CTX" \
    -b "$NBATCH" \
    -ub "$UBATCH" \
    -ctk "$KV_TYPE" \
    -ctv "$KV_TYPE" \
    --temp 0.3 \
    --top-p 0.9 \
    --top-k 40 \
    --repeat-penalty 1.05
