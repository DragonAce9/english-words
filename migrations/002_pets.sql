CREATE TABLE IF NOT EXISTS pets (
  user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 22 CHECK (coins >= 0),
  hunger integer NOT NULL DEFAULT 0 CHECK (hunger BETWEEN 0 AND 100),
  mood integer NOT NULL DEFAULT 0 CHECK (mood BETWEEN 0 AND 100),
  home integer NOT NULL DEFAULT 55 CHECK (home BETWEEN 0 AND 100),
  study integer NOT NULL DEFAULT 40 CHECK (study BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'suffering', 'cryo', 'graduated')),
  last_tick_at timestamptz NOT NULL DEFAULT now(),
  suffering_started_at timestamptz,
  cryo_at timestamptz,
  graduated_at timestamptz
);
