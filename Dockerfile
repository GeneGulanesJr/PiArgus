FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    python3-venv \
    supervisor \
    curl \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g puppeteer-core

ARG OBSCURA_VERSION=latest
RUN curl -LO https://github.com/h4ckf0r0day/obscura/releases/${OBSCURA_VERSION}/download/obscura-x86_64-linux.tar.gz \
    && tar xzf obscura-x86_64-linux.tar.gz -C /usr/local/bin/ \
    && rm obscura-x86_64-linux.tar.gz \
    && chmod +x /usr/local/bin/obscura

RUN pip3 install --no-cache-dir --break-system-packages searxng granian

COPY docker/searxng-settings.yml /etc/searxng/settings.yml
COPY docker/supervisord.conf /etc/supervisor/conf.d/piargus.conf

EXPOSE 9222 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/piargus.conf"]
