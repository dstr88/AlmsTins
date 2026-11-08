-- receivables_subscriptions (receivables tier, T1). The table itself is created at runtime by the
-- registry's idempotent ensure (src/lib/receivables/schema.ts CREATE_RECEIVABLES_SUBSCRIPTIONS);
-- these are the row-level policy and the foreign key, applied by hand after the first deploy that
-- creates it, the same way 20260618_rls_policies.sql and 20260618_foreign_keys.sql were.

DROP POLICY IF EXISTS tenant_isolation ON receivables_subscriptions;
ALTER TABLE receivables_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receivables_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE receivables_subscriptions ADD CONSTRAINT fk_receivables_subscriptions_1 FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
