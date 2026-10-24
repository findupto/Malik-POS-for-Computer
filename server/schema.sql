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

-- Immutable transaction ledger foundation. Register UI migration is a separate rollout gate.
CREATE TABLE IF NOT EXISTS pos_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  idempotency_key uuid NOT NULL,
  order_id text NOT NULL,
  kind text NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale')),
  currency text NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
  customer_name text NOT NULL DEFAULT 'Walk-in Customer',
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  service_charge_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (service_charge_amount >= 0),
  delivery_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  notes text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES staff_users(id),
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, idempotency_key),
  UNIQUE (location_id, order_id)
);
CREATE INDEX IF NOT EXISTS pos_transactions_location_created_idx ON pos_transactions(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  product_id text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS pos_transaction_lines_transaction_idx ON pos_transaction_lines(transaction_id);

CREATE TABLE IF NOT EXISTS pos_tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('Cash','Card','Bank Transfer','Mobile Wallet','Credit','Other')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  reference text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES locations(id),
  actor_id uuid REFERENCES staff_users(id),
  action text NOT NULL,
  entity text NOT NULL,
  record_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_location_created_idx ON audit_events(location_id, created_at DESC);


-- Inventory is explicitly tracked per location. A balance row must be initialized
-- through an adjustment before sales affect that product's on-hand quantity.
CREATE TABLE IF NOT EXISTS inventory_balances (
  location_id uuid NOT NULL REFERENCES locations(id),
  product_id text NOT NULL,
  sku text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_by uuid REFERENCES staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, product_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  idempotency_key uuid NOT NULL,
  product_id text NOT NULL,
  sku text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
  quantity_after numeric(14,3) NOT NULL CHECK (quantity_after >= 0),
  reason text NOT NULL,
  reference_type text NOT NULL DEFAULT 'adjustment' CHECK (reference_type IN ('adjustment','sale','refund')),
  reference_id uuid,
  actor_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS inventory_movements_location_created_idx ON inventory_movements(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('Cash','Card','Bank Transfer','Mobile Wallet','Other')),
  reason text NOT NULL,
  restocked boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS pos_refunds_transaction_idx ON pos_refunds(transaction_id, created_at);

CREATE TABLE IF NOT EXISTS pos_refund_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES pos_refunds(id) ON DELETE RESTRICT,
  product_id text NOT NULL DEFAULT '',
  product_name text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0)
);
