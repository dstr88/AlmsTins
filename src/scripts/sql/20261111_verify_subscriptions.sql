-- verify_subscriptions (the plan an account is on in Almstins Verify). The table itself is created
-- at runtime by the idempotent ensure (src/lib/verifyEntitlements.ts CREATE_VERIFY_SUBSCRIPTIONS,
-- run by ensureVerifyTables); these are the row-level policy and the foreign key, applied by hand
-- after the first deploy that creates it, the same way 20261107_receivables_subscriptions.sql was.

DROP POLICY IF EXISTS tenant_isolation ON verify_subscriptions;
ALTER TABLE verify_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON verify_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE verify_subscriptions ADD CONSTRAINT fk_verify_subscriptions_1 FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
