-- PostgreSQL官方入口仅在新数据卷初始化时执行。不要对已有数据库重复初始化。
-- psql的SQL字面量引用负责转义密码；不拼接shell/SQL，不打印凭证。
\getenv app_password APP_DB_PASSWORD
BEGIN;
CREATE ROLE gameintegrator_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION CONNECTION LIMIT 8 PASSWORD :'app_password';
REVOKE ALL ON DATABASE gameintegrator_smoke FROM PUBLIC;
GRANT CONNECT ON DATABASE gameintegrator_smoke TO gameintegrator_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gameintegrator_app;
COMMIT;
