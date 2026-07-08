FROM node:22-bookworm-slim

WORKDIR /app

# procps provides `ps`, which tree-kill needs on Linux to walk a process tree
# (used to stop scan/pipeline jobs). Without it, spawn('ps', ...) throws
# ENOENT as an unhandled error event and crashes the whole Node process.
RUN apt-get update && apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/*

# Copy everything
COPY . .

# Install web dependencies and build the frontend
RUN npm install -g @anthropic-ai/claude-code && \
    cd web && npm install && npm run build

# Install Playwright Chromium into /app/pw-browsers so chown covers it
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers
RUN npx --prefix /app/web playwright install --with-deps chromium

# Create a non-root user with a real home dir (claude needs ~/.claude for config)
RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /bin/sh appuser && \
    chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production

# Railway injects PORT automatically
EXPOSE 3000

CMD ["node", "web/server.mjs"]
