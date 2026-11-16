-- Manual rollback for 20261109100000_add_shortlist_notes_and_updated_at (Prisma does not run this file).
-- Drops the added Shortlist columns (`notes` and `updated_at`). Back up any saved shortlist notes first.
-- Afterwards run: prisma migrate resolve --rolled-back 20261109100000_add_shortlist_notes_and_updated_at
ALTER TABLE `shortlist` DROP COLUMN `updated_at`,
    DROP COLUMN `notes`;

