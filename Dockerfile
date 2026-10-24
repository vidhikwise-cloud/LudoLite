# Ludo With Friends — API server.
#
# Multi-stage so the runtime image carries no build toolchain, no source, and
# no dev dependencies. Runs as a non-root user with a read-only-friendly
# layout, because this process will eventually handle payments.

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma needs OpenSSL for its query engine on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY packages/engine/package.json  packages/engine/
COPY packages/shared/package.json  packages/shared/
COPY apps/server/package.json      apps/server/
COPY apps/web/package.json         apps/web/

# `npm ci` honours the lockfile exactly — a build must never silently pick up
# a different version from the one that was tested.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate --schema apps/server/prisma/schema.prisma \
 && npx tsc -p packages/engine/tsconfig.json \
 && npx tsc -p packages/shared/tsconfig.json \
 && npx tsc -p apps/server/tsconfig.json

# Drop dev dependencies from the tree we are about to copy forward.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl tini \
 && addgroup -S ludo && adduser -S ludo -G ludo

ENV NODE_ENV=production
ENV PORT=4000

# Paid hosting is off in the image itself. Enabling it requires both an env
# change AND the approval records in the database — see docs/COMPLIANCE.md.
ENV PAID_ROOM_HOSTING_ENABLED=false
ENV PAYMENT_PROVIDER=none

COPY --from=build --chown=ludo:ludo /app/node_modules          ./node_modules
COPY --from=build --chown=ludo:ludo /app/packages/engine/dist  ./packages/engine/dist
COPY --from=build --chown=ludo:ludo /app/packages/engine/package.json ./packages/engine/
COPY --from=build --chown=ludo:ludo /app/packages/shared/dist  ./packages/shared/dist
COPY --from=build --chown=ludo:ludo /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=ludo:ludo /app/apps/server/dist      ./apps/server/dist
COPY --from=build --chown=ludo:ludo /app/apps/server/package.json ./apps/server/
COPY --from=build --chown=ludo:ludo /app/apps/server/prisma    ./apps/server/prisma
COPY --from=build --chown=ludo:ludo /app/package.json          ./

USER ludo
EXPOSE 4000

# tini reaps zombies and, more importantly here, forwards SIGTERM properly so
# the graceful drain in main.ts actually runs on deploy.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/main.js"]
