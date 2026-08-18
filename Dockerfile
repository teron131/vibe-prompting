# syntax=docker/dockerfile:1

FROM node:24-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

COPY .oxfmtrc.jsonc .oxlintrc.json ./
COPY frontend frontend
COPY migrations migrations
COPY src src

RUN pnpm run typecheck && pnpm run frontend:build

FROM node:24-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app/frontend

COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 8080

CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port \"${PORT:-8080}\""]
