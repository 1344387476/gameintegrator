-- 不导入旧云开发数据；身份与会话先独立建模，房间/账本在下一批迁移中增加。
CREATE TABLE users (
  id uuid PRIMARY KEY,
  app_id text NOT NULL CHECK (app_id ~ '^wx[0-9a-f]{16}$'),
  openid text NOT NULL CHECK (length(openid) BETWEEN 1 AND 128),
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 10),
  avatar_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, openid)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
