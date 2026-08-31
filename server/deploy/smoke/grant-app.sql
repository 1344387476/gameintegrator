-- 必须先成功执行版本迁移。新增业务表时显式更新授权，不默认授权所有未来表。
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO gameintegrator_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rooms, room_members, active_room_memberships TO gameintegrator_app;
GRANT SELECT, INSERT ON room_commands TO gameintegrator_app;
GRANT SELECT, INSERT ON score_ledger, score_ledger_changes TO gameintegrator_app;
GRANT SELECT, INSERT ON histories, history_players TO gameintegrator_app;
GRANT SELECT, INSERT, DELETE ON room_qrcodes TO gameintegrator_app;
GRANT SELECT ON schema_migrations TO gameintegrator_app;
COMMIT;
