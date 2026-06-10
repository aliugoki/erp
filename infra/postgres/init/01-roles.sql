-- Postgres role bootstrap (runs once on a fresh data dir; also applied manually to existing volumes).
--
-- The ERP API connects as a NON-superuser, NON-BYPASSRLS role so that Row-Level Security is actually
-- enforced (ADR-002). The superuser/owner role (POSTGRES_USER) is used only for migrations/DDL, which
-- connect DIRECTLY to Postgres, bypassing PgBouncer. Defense in depth: even a forgotten WHERE cannot
-- cross tenants because the app's role is subject to RLS.
--
-- NOTE: the dev password here is a local-only placeholder. Production manages this credential out of
-- band (secrets manager — ADR-006/8.3), never from a committed file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_pass'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Schema + (future) object access. ALTER DEFAULT PRIVILEGES applies to objects later created by the
-- role running this (the owner/migrator), so app_user automatically gets CRUD on new tables.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
