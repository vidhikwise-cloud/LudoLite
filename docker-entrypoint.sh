#!/bin/sh
#
# Container startup.
#
# Applies migrations and seeds the compliance rows before starting the
# server. The Render blueprint does this in preDeployCommand, but a Docker
# service ignores that — so the container has to be self-sufficient or it
# would start against an old schema.
#
# Fails fast and loudly: a server running against the wrong schema is worse
# than a server that refused to start.

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set. The server cannot start without a database." >&2
  echo "On Render, attach a Postgres instance or use the Blueprint." >&2
  exit 1
fi

echo "Applying database migrations..."
npx prisma migrate deploy --schema apps/server/prisma/schema.prisma

# Seeds the two compliance approvals as `not_started` if they are missing.
# Idempotent, and it can never grant an approval — see prisma/seed.ts.
echo "Seeding compliance rows..."
node apps/server/dist/scripts/seed-compliance.js || {
  echo "Compliance seeding failed; refusing to start." >&2
  exit 1
}

echo "Starting server..."
exec node apps/server/dist/main.js
