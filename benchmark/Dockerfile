FROM node:24-bookworm

WORKDIR /app

COPY --from=golang:1.27.4-bookworm /usr/local/go /usr/local/go
COPY --from=oven/bun:1.4-debian /usr/local/bin/bun /usr/local/bin/bun

ENV PATH=/usr/local/go/bin:/usr/local/bin:$PATH

RUN npm install -g pnpm@12.18.0 \
	&& git config --system --add safe.directory /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

ENTRYPOINT ["/bin/bash", "/app/benchmark/entrypoint.sh"]
