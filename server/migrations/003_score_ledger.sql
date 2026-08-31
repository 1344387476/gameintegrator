ALTER TABLE rooms ADD COLUMN pot bigint NOT NULL DEFAULT 0 CHECK (pot BETWEEN 0 AND 9007199254740991);
ALTER TABLE rooms ADD COLUMN base_bet_value bigint CHECK (base_bet_value BETWEEN 1 AND 9007199254740991);
ALTER TABLE rooms ADD CONSTRAINT rooms_normal_no_pot CHECK (mode = 'bet' OR (pot = 0 AND base_bet_value IS NULL));
ALTER TABLE room_members ADD COLUMN last_deposit_amount bigint CHECK (last_deposit_amount BETWEEN 1 AND 9007199254740991);
ALTER TABLE room_members ADD COLUMN last_deposit_at timestamptz;
ALTER TABLE room_members ADD CONSTRAINT room_members_deposit_pair CHECK ((last_deposit_amount IS NULL) = (last_deposit_at IS NULL));

ALTER TABLE room_commands DROP CONSTRAINT room_commands_action_check;
ALTER TABLE room_commands ADD CONSTRAINT room_commands_action_check CHECK (action IN (
  'create', 'join_code', 'join_id', 'leave', 'transfer_owner',
  'TRANSFER', 'BATCH_TRANSFER', 'BET', 'BASE_BET', 'ALLIN', 'CLAIM', 'SET_BASE_BET'
));

-- 业务流水与最小幂等回执分离；随房间保留，最后退出删除房间时级联删除流水。
CREATE TABLE score_ledger (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  operation_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('TRANSFER', 'BATCH_TRANSFER', 'BET', 'BASE_BET', 'ALLIN', 'CLAIM', 'SET_BASE_BET')),
  state_version bigint NOT NULL CHECK (state_version BETWEEN 1 AND 9007199254740991),
  amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  pot_before bigint NOT NULL CHECK (pot_before BETWEEN 0 AND 9007199254740991),
  pot_after bigint NOT NULL CHECK (pot_after BETWEEN 0 AND 9007199254740991),
  base_bet_before bigint CHECK (base_bet_before BETWEEN 1 AND 9007199254740991),
  base_bet_after bigint CHECK (base_bet_after BETWEEN 1 AND 9007199254740991),
  actor_nickname text NOT NULL CHECK (length(actor_nickname) BETWEEN 1 AND 10),
  actor_avatar_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, state_version),
  FOREIGN KEY (room_id, actor_user_id) REFERENCES room_members(room_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, operation_id) REFERENCES room_commands(user_id, operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX score_ledger_avatar_idx ON score_ledger(room_id, actor_avatar_file_id) WHERE actor_avatar_file_id IS NOT NULL;

CREATE TABLE score_ledger_changes (
  entry_id uuid NOT NULL REFERENCES score_ledger(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  nickname text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 10),
  avatar_file_id text,
  score_before bigint NOT NULL CHECK (score_before BETWEEN -9007199254740991 AND 9007199254740991),
  score_after bigint NOT NULL CHECK (score_after BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (score_before <> score_after),
  PRIMARY KEY (entry_id, user_id)
);
CREATE INDEX score_ledger_changes_avatar_idx ON score_ledger_changes(avatar_file_id, entry_id) WHERE avatar_file_id IS NOT NULL;
