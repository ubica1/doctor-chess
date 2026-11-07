FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home doctor \
    && mkdir /data && chown doctor:doctor /data

WORKDIR /app
COPY doctor-chess-site/*.py doctor-chess-site/*-runner.cjs ./
COPY doctor-chess-site/puzzle-catalog.jsonl ./
COPY doctor-chess-site/dist ./dist
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DOCTOR_CHESS_HOST=0.0.0.0 \
    DOCTOR_CHESS_DB=/data/chess.sqlite3 \
    PORT=4173
USER doctor
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4173/healthz', timeout=4).close()"
CMD ["python", "server.py"]
