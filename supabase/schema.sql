-- ============================================================
-- Shopify Handling Fee App - Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Sessions table (Shopify OAuth sessions)
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  state TEXT,
  is_online BOOLEAN DEFAULT FALSE,
  scope TEXT,
  expires TIMESTAMPTZ,
  access_token TEXT,
  user_id BIGINT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  account_owner BOOLEAN,
  locale TEXT,
  collaborator BOOLEAN,
  email_verified BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_sessions_shop ON shopify_sessions(shop);

-- ============================================================
-- Fee Rules table
-- ============================================================
CREATE TABLE IF NOT EXISTS fee_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_domain TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('product', 'collection')),
  shopify_id TEXT NOT NULL,
  shopify_title TEXT NOT NULL DEFAULT '',
  shopify_image_url TEXT,
  fee_amount DECIMAL(10, 2) NOT NULL CHECK (fee_amount >= 0),
  fee_type TEXT NOT NULL DEFAULT 'fixed' CHECK (fee_type IN ('fixed', 'percentage')),
  fee_label TEXT NOT NULL DEFAULT 'Handling Fee',
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_domain, rule_type, shopify_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_shop ON fee_rules(shop_domain);
CREATE INDEX IF NOT EXISTS idx_fee_rules_active ON fee_rules(shop_domain, is_active);

-- ============================================================
-- App Settings table (one row per shop)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_domain TEXT UNIQUE NOT NULL,
  default_fee_label TEXT DEFAULT 'Handling Fee',
  app_enabled BOOLEAN DEFAULT TRUE,
  conflict_resolution TEXT DEFAULT 'highest' CHECK (
    conflict_resolution IN ('highest', 'lowest', 'product', 'collection', 'sum')
  ),
  handling_fee_product_gid TEXT,
  handling_fee_variant_gid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_fee_rules_updated_at ON fee_rules;
CREATE TRIGGER update_fee_rules_updated_at
  BEFORE UPDATE ON fee_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON app_settings;
CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist before recreating
DROP POLICY IF EXISTS "service_role_fee_rules" ON fee_rules;
DROP POLICY IF EXISTS "service_role_app_settings" ON app_settings;
DROP POLICY IF EXISTS "service_role_shopify_sessions" ON shopify_sessions;

CREATE POLICY "service_role_fee_rules"
  ON fee_rules FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_app_settings"
  ON app_settings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_shopify_sessions"
  ON shopify_sessions FOR ALL USING (true) WITH CHECK (true);
