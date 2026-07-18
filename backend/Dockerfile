# Cloud Run container for the NJEIS backend. Uses node:20-slim (not -alpine) and
# installs Google Chrome directly, because Puppeteer (pdfGenerator.js's invoice
# PDF rendering) needs a real Chromium binary and its shared libraries — alpine's
# musl libc is missing several of them, and downloading Puppeteer's own bundled
# Chromium is redundant once we've already installed Chrome via apt.
FROM node:20-slim

# Skip Puppeteer's own Chromium download — we install Chrome via apt below instead,
# and point PUPPETEER_EXECUTABLE_PATH at it.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget gnupg ca-certificates \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run sets PORT itself; index.js already reads process.env.PORT with a fallback.
EXPOSE 8080

CMD ["node", "index.js"]
