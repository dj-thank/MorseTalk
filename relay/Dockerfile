FROM python:3.12-slim
WORKDIR /relay
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --no-create-home relay
COPY server.py .
USER 10001
ENV HOST=0.0.0.0 PORT=8787 PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["python", "server.py"]
