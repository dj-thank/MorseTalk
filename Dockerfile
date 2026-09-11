FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY relay/requirements.txt /tmp/relay-requirements.txt
RUN python3 -m venv /opt/testenv && /opt/testenv/bin/pip install --no-cache-dir -r /tmp/relay-requirements.txt
ENV PATH="/opt/testenv/bin:${PATH}"
COPY . .
CMD ["bash", "-c", "node scripts/build.mjs && node --test tests/*.test.mjs && /opt/testenv/bin/python3 -m unittest discover -s tests -p 'test_*.py' -v"]
