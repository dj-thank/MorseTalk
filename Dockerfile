FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY . .
CMD ["bash", "-lc", "node scripts/build.mjs && node --test tests/*.test.mjs && python3 -m unittest discover -s tests -p 'test_*.py' -v"]
