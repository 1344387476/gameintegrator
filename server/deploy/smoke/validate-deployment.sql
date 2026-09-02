\set ON_ERROR_STOP on

SELECT
  count(*) AS rooms_total,
  count(*) FILTER (WHERE status = 'active') AS rooms_active,
  count(*) FILTER (WHERE status = 'settled') AS rooms_settled,
  count(*) FILTER (WHERE mode = 'normal') AS rooms_normal,
  count(*) FILTER (WHERE mode = 'bet') AS rooms_bet
FROM rooms;

SELECT count(*) AS histories_total FROM histories;
SELECT action, count(*) AS entries FROM score_ledger GROUP BY action ORDER BY action;
SELECT action, count(*) AS receipts FROM room_commands GROUP BY action ORDER BY action;

SELECT count(*) AS unbalanced_rooms
FROM rooms AS room
WHERE room.pot + COALESCE((
  SELECT sum(member.score) FROM room_members AS member WHERE member.room_id = room.id
), 0) <> 0;

SELECT count(*) AS unbalanced_histories
FROM histories AS history
WHERE COALESCE((
  SELECT sum(player.score) FROM history_players AS player WHERE player.history_id = history.id
), 0) <> 0;

SELECT count(*) AS invalid_settled_histories
FROM histories AS history
JOIN rooms AS room ON room.id = history.room_id
WHERE room.status <> 'settled' OR room.state_version <> history.state_version;

SELECT count(*) AS invalid_active_memberships
FROM active_room_memberships AS active
JOIN rooms AS room ON room.id = active.room_id
JOIN room_members AS member ON member.room_id = active.room_id AND member.user_id = active.user_id
WHERE room.status <> 'active' OR member.is_exited;
