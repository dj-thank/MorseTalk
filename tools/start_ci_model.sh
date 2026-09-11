#!/usr/bin/env bash
# Real model only. Failure to download/start fails verification; no canned replies.
set -euo pipefail
mkdir -p test-results
model="${MORSETALK_AI_MODEL:-qwen2.5:0.5b}"
docker run -d --name morsetalk-ollama --cpus=2 --memory=3g \
  -p 127.0.0.1:11434:11434 -e OLLAMA_NUM_PARALLEL=1 ollama/ollama:0.6.8
for n in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:11434/api/version > test-results/ollama-version.json; then break; fi
  sleep 1
done
timeout 600 docker exec morsetalk-ollama ollama pull "$model"
curl -fsS http://127.0.0.1:11434/api/tags > test-results/model-inventory.json
docker inspect morsetalk-ollama --format '{{.Image}}' > test-results/model-container-image.txt
