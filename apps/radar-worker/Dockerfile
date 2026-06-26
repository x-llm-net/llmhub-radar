FROM node:24-slim AS install
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME="/pnpm" PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN corepack enable pnpm && \
    pnpm config set registry "$NPM_REGISTRY" && \
    pnpm config set fetch-timeout 300000 && \
    pnpm config set fetch-retries 5

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages

RUN pnpm install --prod --frozen-lockfile

FROM oven/bun:1.3.11 AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/dashboard

COPY --from=install /app/node_modules /app/node_modules
COPY --from=install /app/apps/dashboard/node_modules /app/apps/dashboard/node_modules
COPY --from=install /app/packages /app/packages
COPY apps/dashboard/package.json /app/apps/dashboard/package.json
COPY apps/dashboard/src/scripts /app/apps/dashboard/src/scripts
COPY packages/db/drizzle /app/packages/db/drizzle
COPY packages/db/src/migrate.mts /app/packages/db/src/migrate.mts

USER 1000:1000

CMD ["bun", "src/scripts/radar-cron-loop.ts"]
