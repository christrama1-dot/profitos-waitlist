# ProfitOS Audit Engine (WF-08) — production container.
# Uses the system Chromium so Puppeteer renders the branded PDF without
# downloading its own browser at build time. pdfkit remains the fallback.
FROM node:22-slim

# Chromium + the libraries Puppeteer needs to run headless in a container.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium instead of downloading one.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# Render/Railway inject PORT; default to 8080 for local runs.
ENV PORT=8080
EXPOSE 8080

# Run as the non-root user that ships with the node image.
USER node

CMD ["node", "src/server.js"]
