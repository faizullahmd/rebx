-- Manual rollback for 20261015100000_add_email_layout (Prisma does not run this file).
-- Removes the shared email layout settings; emails fall back to the built-in default layout.
-- Afterwards run: prisma migrate resolve --rolled-back 20261015100000_add_email_layout
DROP TABLE IF EXISTS `EmailLayout`;
