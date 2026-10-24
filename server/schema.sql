CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Karachi',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','manager','cashier')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_records (
  location_id uuid NOT NULL REFERENCES locations(id),
  entity text NOT NULL,
  record_id text NOT NULL,
  payload jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, entity, record_id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  sequence bigserial UNIQUE NOT NULL,
  event_id uuid PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES locations(id),
  entity text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','delete')),
  payload jsonb,
  actor_id uuid REFERENCES staff_users(id),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_events_location_sequence_idx ON sync_events(location_id, sequence);
CREATE INDEX IF NOT EXISTS pos_records_location_entity_idx ON pos_records(location_id, entity);
