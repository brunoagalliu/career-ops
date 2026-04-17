FROM node:22-alpine

WORKDIR /app

# Copy everything (personal data files included via railway up)
COPY . .

# Install web dependencies and build the frontend
RUN npm install -g @anthropic-ai/claude-code && \
    cd web && npm install && npm run build

# Create a non-root user (required for claude --dangerously-skip-permissions)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production

# Railway injects PORT automatically
EXPOSE 3000

CMD ["node", "web/server.mjs"]
