#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${LIFT_ENV_FILE:-/home/liharr/.config/lift-log.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing private env file: $ENV_FILE; provision only with operator approval." >&2
  exit 1
fi
source "$ENV_FILE"
: "${LIFT_PG_PASSWORD:?LIFT_PG_PASSWORD must be set}"
: "${LIFT_MONITOR_PG_PASSWORD:?LIFT_MONITOR_PG_PASSWORD must be set}"
if [[ ! "$LIFT_PG_PASSWORD" =~ ^[a-f0-9]{64}$ || ! "$LIFT_MONITOR_PG_PASSWORD" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Use independently generated 32-byte hex passwords." >&2
  exit 1
fi
docker exec -i traffic-monitor-db-1 psql -U umami -d umami -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE ROLE lift_log LOGIN PASSWORD ''${LIFT_PG_PASSWORD}'''
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lift_log')\gexec
SELECT 'CREATE ROLE lift_log_monitor LOGIN PASSWORD ''${LIFT_MONITOR_PG_PASSWORD}'''
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lift_log_monitor')\gexec
SELECT 'CREATE DATABASE lift_log OWNER lift_log'
WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='lift_log')\gexec
SQL
docker exec -i -e PGPASSWORD="$LIFT_PG_PASSWORD" traffic-monitor-db-1 \
  psql -h localhost -U lift_log -d lift_log -v ON_ERROR_STOP=1 < db/schema.sql
docker exec -i traffic-monitor-db-1 psql -U umami -d lift_log -v ON_ERROR_STOP=1 <<'SQL'
REVOKE CONNECT ON DATABASE lift_log FROM PUBLIC;
GRANT CONNECT ON DATABASE lift_log TO lift_log, lift_log_monitor;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lift_log_monitor;
GRANT SELECT ON service_health TO lift_log_monitor;
SQL
echo "Lift Log database and read-only health view ready."
