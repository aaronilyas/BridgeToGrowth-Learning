FROM docker:29-cli AS docker-cli
FROM python:3.12-slim-bookworm

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/*.py /app/backend/
# Root is required for the default host Docker socket. Only this service has
# that mount; no renderer or Photon SDK is installed in this image.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
