#!/usr/bin/env bash
# Real model only. A registry failure never enables canned replies or a fake model.
set -euo pipefail
mkdir -p test-results
model="${MORSETALK_AI_MODEL:-qwen2.5:0.5b}"
docker run -d --name morsetalk-ollama --cpus=2 --memory=3g \
  -p 127.0.0.1:11434:11434 -e OLLAMA_NUM_PARALLEL=1 ollama/ollama:0.6.8
ready=0
for n in $(seq 1 60); do
  if curl --max-time 3 -fsS http://127.0.0.1:11434/api/version > test-results/ollama-version.json; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then echo 'Ollama did not become ready' >&2; exit 1; fi
# The registry can time out independently of the 300-second outer budget.
# Keep bounded retries and each complete failure log as auditable evidence.
pulled=0
for attempt in 1 2 3; do
  log="test-results/model-pull-${attempt}.log"
  echo "Model pull attempt ${attempt}: ${model}" | tee -a test-results/model-pull-attempts.txt
  if timeout 300 docker exec morsetalk-ollama ollama pull "$model" > "$log" 2>&1; then
    pulled=1
    echo "attempt ${attempt}: success" | tee -a test-results/model-pull-attempts.txt
    break
  else
    status=$?
    echo "attempt ${attempt}: failed (exit ${status})" | tee -a test-results/model-pull-attempts.txt
  fi
  if [ "$attempt" != 3 ]; then sleep 3; fi
done
if [ "$pulled" != 1 ]; then echo 'Real model unavailable after three attempts; verification fails.' >&2; exit 1; fi
curl --max-time 10 -fsS http://127.0.0.1:11434/api/tags > test-results/model-inventory.json
docker inspect morsetalk-ollama --format '{{.Image}}' > test-results/model-container-image.txt
