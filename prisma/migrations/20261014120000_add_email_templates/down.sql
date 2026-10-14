-- Manual rollback for 20261014120000_add_email_templates (Prisma does not run this file).
-- Drops everything the migration created, in dependency order. Destroys all email template
-- data, version history, test logs and the admin audit log. Back up first.
-- After running it, also run: prisma migrate resolve --rolled-back 20261014120000_add_email_templates
DROP TABLE IF EXISTS `EmailTestLog`;
DROP TABLE IF EXISTS `EmailTemplateVersion`;
DROP TABLE IF EXISTS `EmailTemplateDraft`;
DROP TABLE IF EXISTS `EmailTemplate`;
DROP TABLE IF EXISTS `AdminAuditLog`;
