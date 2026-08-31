-- 用户和房间按AppID隔离；玩家独立成行，避免整包覆盖积分。
ALTER TABLE users ADD CONSTRAINT users_app_id_id_key UNIQUE (app_id, id);

CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  app_id text NOT NULL,
  room_code text NOT NULL CHECK (room_code ~ '^[A-Z0-9]{6}$'),
  room_name text NOT NULL CHECK (length(room_name) BETWEEN 1 AND 20),
  mode text NOT NULL CHECK (mode IN ('normal', 'bet')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled')),
  owner_user_id uuid NOT NULL,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, id),
  UNIQUE (app_id, room_code),
  FOREIGN KEY (app_id, owner_user_id) REFERENCES users(app_id, id)
);

CREATE TABLE room_members (
  room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  app_id text NOT NULL,
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 8),
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 10),
  avatar_file_id text,
  score bigint NOT NULL DEFAULT 0 CHECK (score BETWEEN -9007199254740991 AND 9007199254740991),
  is_exited boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, seat),
  FOREIGN KEY (app_id, room_id) REFERENCES rooms(app_id, id) ON DELETE CASCADE,
  FOREIGN KEY (app_id, user_id) REFERENCES users(app_id, id)
);
CREATE INDEX room_members_user_idx ON room_members(user_id);
ALTER TABLE rooms ADD CONSTRAINT rooms_owner_membership_fk
  FOREIGN KEY (id, owner_user_id) REFERENCES room_members(room_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

-- 唯一主键直接保证一个用户只能关联一个活动房间；退出不删除room_members账本。
CREATE TABLE active_room_memberships (
  user_id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  FOREIGN KEY (room_id, user_id) REFERENCES room_members(room_id, user_id) ON DELETE CASCADE
);
CREATE INDEX active_room_memberships_room_idx ON active_room_memberships(room_id);

-- 只保存参数摘要和最小操作回执，不保存昵称/头像/积分快照。
-- 不随房间级联删除，防止最后退出后重放旧create/join请求重新创建/加入。
CREATE TABLE room_commands (
  user_id uuid NOT NULL REFERENCES users(id),
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 8 AND 80),
  action text NOT NULL CHECK (action IN ('create', 'join_code', 'join_id', 'leave', 'transfer_owner')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
