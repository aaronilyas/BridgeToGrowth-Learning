FROM manimcommunity/manim:v0.19.0
USER root
RUN pip install --no-cache-dir 'manim-voiceover[gtts]>=0.3,<0.4'
COPY backend/container/worker.py /opt/worker.py
COPY backend/integrations.py /opt/integrations.py
ENV HOME=/tmp PYTHONDONTWRITEBYTECODE=1
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["sleep", "infinity"]
