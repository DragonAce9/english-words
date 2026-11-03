CREATE TABLE IF NOT EXISTS daily_facts (
  day date PRIMARY KEY,
  kind text NOT NULL,
  body text NOT NULL,
  polished boolean NOT NULL DEFAULT false,
  polish_attempts integer NOT NULL DEFAULT 0,
  posted_at timestamptz
);

CREATE TABLE IF NOT EXISTS user_fact_unlocks (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day date NOT NULL REFERENCES daily_facts (day),
  PRIMARY KEY (user_id, day)
);
