-- Normalize legacy empty-string tenant markers.
UPDATE auth_users
SET active_tenant_id = NULL
WHERE active_tenant_id = '';

-- Runtime forbids the legacy default tenant as active. Clear it so user flows can re-attach safely.
UPDATE auth_users
SET active_tenant_id = NULL
WHERE active_tenant_id = 'default';

-- Deterministic membership lookup support.
CREATE INDEX IF NOT EXISTS tenant_memberships_user_created_idx
  ON tenant_memberships(user_id, created_at, id);

DROP TRIGGER IF EXISTS trg_auth_users_active_tenant_membership_guard;
CREATE TRIGGER trg_auth_users_active_tenant_membership_guard
BEFORE UPDATE OF active_tenant_id ON auth_users
FOR EACH ROW
WHEN NEW.active_tenant_id IS NOT NULL AND NEW.active_tenant_id != ''
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM tenant_memberships tm
      WHERE tm.user_id = NEW.id AND tm.tenant_id = NEW.active_tenant_id
    ) THEN RAISE(ABORT, 'active_tenant_id requires membership')
  END;
END;
