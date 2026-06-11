# Slim, reproducible multi-stage build. Builder installs the hard-pinned deps into a venv and bakes the
# embedding model; the runtime stage copies only the venv + model + app and runs as a non-root user.
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements.txt .
RUN pip install --require-virtualenv -r requirements.txt
# Bake the sentence-embedding model into the image (Chunk 6.4) so the service needs no network at
# runtime and starts fast. Explicit cache_dir — fastembed doesn't reliably honor the env var.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/models')"

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH="/opt/venv/bin:$PATH" FASTEMBED_CACHE_DIR=/opt/models
# tesseract-ocr for the scanned-image OCR path (pytesseract).
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 mluser
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder --chown=10001:10001 /opt/models /opt/models
WORKDIR /app
COPY app ./app
USER mluser
ENV ML_PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f\"http://127.0.0.1:{os.getenv('ML_PORT','8000')}/health\").status==200 else 1)"
# Shell form so ${ML_PORT} is expanded at runtime (configurable port for host-network runs).
CMD uvicorn app.main:app --host 0.0.0.0 --port ${ML_PORT:-8000}
