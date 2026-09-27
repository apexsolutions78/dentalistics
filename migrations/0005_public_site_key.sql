ALTER TABLE organizations
  ADD COLUMN site_key CHAR(64) NULL,
  ADD UNIQUE KEY uq_organizations_site_key (site_key);

UPDATE organizations
SET site_key = SHA2(CONCAT(UUID(), UUID()), 256)
WHERE site_key IS NULL;
