CREATE TABLE IF NOT EXISTS app_state (
  id integer PRIMARY KEY CHECK (id = 1),
  revision integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW service_health AS
SELECT EXISTS(SELECT 1 FROM app_state WHERE id = 1) AS initialized,
       (SELECT updated_at FROM app_state WHERE id = 1) AS last_write_at;
