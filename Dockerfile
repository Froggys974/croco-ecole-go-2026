FROM node:24-bookworm AS base
WORKDIR /app
COPY --from=golang:1.27.4-bookworm /usr/local/go /usr/local/go
ENV PATH=/home/node/.local/bin:/usr/local/go/bin:/home/node/go/bin:$PATH
RUN npm install -g pnpm@12.18.0 \
    && git config --system --add safe.directory /app \
    && mkdir -p /app/node_modules /home/node/.claude \
    && chown -R node:node /app /home/node
USER node
RUN curl -fsSL https://claude.ai/install.sh | bash
