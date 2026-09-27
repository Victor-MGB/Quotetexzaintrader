#!/usr/bin/env bash
# Throwaway Postgres for the test suite.
#
# The tests write and delete rows, so they must never point at the database in
# .env. scripts/test-db.env holds the connection details, tests/helpers/env.ts
# defaults DATABASE_URL to that same file, and tests/helpers/db.ts refuses any
# non-local host, so the three together keep a careless `npm test` away from
# production.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/test-db.env
set -a
. scripts/test-db.env
set +a

case "${1:-up}" in
  up)
    if docker ps --format '{{.Names}}' | grep -qx "$QZT_TEST_DB_CONTAINER"; then
      echo "$QZT_TEST_DB_CONTAINER is already running on port $QZT_TEST_DB_PORT"
    else
      docker rm -f "$QZT_TEST_DB_CONTAINER" >/dev/null 2>&1 || true
      docker run -d --name "$QZT_TEST_DB_CONTAINER" \
        -e POSTGRES_PASSWORD="$QZT_TEST_DB_PASSWORD" \
        -e POSTGRES_DB="$QZT_TEST_DB_NAME" \
        -p "$QZT_TEST_DB_PORT:5432" \
        "$QZT_TEST_DB_IMAGE" >/dev/null
      echo "started $QZT_TEST_DB_CONTAINER on port $QZT_TEST_DB_PORT"
    fi

    echo -n "waiting for postgres"
    for _ in $(seq 1 60); do
      if docker exec "$QZT_TEST_DB_CONTAINER" pg_isready -U "$QZT_TEST_DB_USER" -d "$QZT_TEST_DB_NAME" >/dev/null 2>&1; then
        echo " ready"
        break
      fi
      echo -n "."
      sleep 1
    done

    # Migrations are applied to the throwaway only; the URL is passed on the
    # command line so drizzle cannot read the production one out of .env.
    DATABASE_URL="postgresql://${QZT_TEST_DB_USER}:${QZT_TEST_DB_PASSWORD}@${QZT_TEST_DB_HOST}:${QZT_TEST_DB_PORT}/${QZT_TEST_DB_NAME}" \
      DB_SSL=false \
      npx drizzle-kit migrate
    echo
    echo "ready — run: npm test"
    ;;
  down)
    docker rm -f "$QZT_TEST_DB_CONTAINER" >/dev/null 2>&1 \
      && echo "removed $QZT_TEST_DB_CONTAINER" \
      || echo "$QZT_TEST_DB_CONTAINER was not running"
    ;;
  *)
    echo "usage: $0 [up|down]" >&2
    exit 1
    ;;
esac
