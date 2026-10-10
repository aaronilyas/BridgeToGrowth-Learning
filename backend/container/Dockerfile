FROM manimcommunity/manim:v0.19.0
USER root
# Manim renders through PyAV; the worker separately needs the ffprobe CLI.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sox \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir 'manim-voiceover[gtts]>=0.3,<0.4'
COPY backend/container/worker.py /opt/worker.py
COPY backend/integrations.py /opt/integrations.py
ENV HOME=/tmp PYTHONDONTWRITEBYTECODE=1
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]
