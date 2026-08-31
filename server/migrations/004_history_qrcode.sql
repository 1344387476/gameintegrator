ALTER TABLE room_commands DROP CONSTRAINT room_commands_action_check;
ALTER TABLE room_commands ADD CONSTRAINT room_commands_action_check CHECK (action IN (
  'create', 'join_code', 'join_id', 'join_scene', 'leave', 'transfer_owner', 'settle', 'dismiss',
  'TRANSFER', 'BATCH_TRANSFER', 'BET', 'BASE_BET', 'ALLIN', 'CLAIM', 'SET_BASE_BET'
));

-- 结算快照独立保存；不允许删除房间时顺带丢失正式战绩。
CREATE TABLE histories (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL UNIQUE,
  app_id text NOT NULL,
  room_name text NOT NULL CHECK (length(room_name) BETWEEN 1 AND 20),
  mode text NOT NULL CHECK (mode IN ('normal', 'bet')),
  owner_user_id uuid NOT NULL,
  settled_by uuid NOT NULL,
  state_version bigint NOT NULL CHECK (state_version BETWEEN 1 AND 9007199254740991),
  ended_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  FOREIGN KEY (app_id, room_id) REFERENCES rooms(app_id, id),
  FOREIGN KEY (app_id, owner_user_id) REFERENCES users(app_id, id),
  FOREIGN KEY (app_id, settled_by) REFERENCES users(app_id, id)
);
CREATE INDEX histories_page_idx ON histories(app_id, ended_at DESC, id DESC);

CREATE TABLE history_players (
  history_id uuid NOT NULL REFERENCES histories(id),
  user_id uuid NOT NULL REFERENCES users(id),
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 8),
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 10),
  avatar_file_id text,
  score bigint NOT NULL CHECK (score BETWEEN -9007199254740991 AND 9007199254740991),
  is_exited boolean NOT NULL,
  PRIMARY KEY (history_id, user_id),
  UNIQUE (history_id, seat)
);
CREATE INDEX history_players_user_idx ON history_players(user_id, history_id);
CREATE INDEX history_players_avatar_idx ON history_players(avatar_file_id, history_id) WHERE avatar_file_id IS NOT NULL;

-- 每个房间最多一张标准化PNG，最大256KiB；小型邀请资源与房间同库清理，避免孤立文件。
CREATE TABLE room_qrcodes (
  room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 262144),
  created_at timestamptz NOT NULL DEFAULT now()
);
