FROM node:24-slim AS install
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME="/pnpm" PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable pnpm && \
    pnpm config set registry "$NPM_REGISTRY" && \
    pnpm config set fetch-timeout 300000 && \
    pnpm config set fetch-retries 5

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/marketplace-api/package.json apps/marketplace-api/package.json
COPY packages packages

RUN pnpm install --prod --frozen-lockfile --filter @llmhub/marketplace-api...

FROM oven/bun:1.3.11 AS runtime
ENV NODE_ENV=production PORT=3010
WORKDIR /app/apps/marketplace-api

COPY --from=install /app/node_modules /app/node_modules
COPY --from=install /app/apps/marketplace-api/node_modules /app/apps/marketplace-api/node_modules
COPY --from=install /app/packages /app/packages
COPY apps/marketplace-api/package.json /app/apps/marketplace-api/package.json
COPY apps/marketplace-api/src /app/apps/marketplace-api/src

USER 1000:1000
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD bun -e 'const response = await fetch("http://127.0.0.1:3010/health"); if (!response.ok) process.exit(1)'

CMD ["bun", "src/index.ts"]
