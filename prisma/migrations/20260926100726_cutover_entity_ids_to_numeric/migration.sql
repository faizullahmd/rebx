-- Cutover Listing/ListingImage/Deal/Booking/Commission/DeveloperRequest ids (and the FKs
-- between them) from String cuid to Int, using the shadow numeric columns populated by
-- scripts/backfill-entity-ids.ts. Must only be run after that script's zero-orphan
-- assertion has passed.

-- 1. Drop the 5 FK constraints among these tables (required before dropping the columns
--    they're on, and before dropping the parent tables' primary keys).
ALTER TABLE `ListingImage` DROP FOREIGN KEY `ListingImage_listingId_fkey`;
ALTER TABLE `Deal` DROP FOREIGN KEY `Deal_listingId_fkey`;
ALTER TABLE `DeveloperRequest` DROP FOREIGN KEY `DeveloperRequest_listingId_fkey`;
ALTER TABLE `Booking` DROP FOREIGN KEY `Booking_dealId_fkey`;
ALTER TABLE `Commission` DROP FOREIGN KEY `Commission_dealId_fkey`;

-- 2. Drop the old string FK columns. MySQL auto-drops any index living *solely* on a
--    dropped single-value column (ListingImage_listingId_idx, Deal_listingId_idx,
--    DeveloperRequest_listingId_idx, Booking_dealId_key, Commission_dealId_idx) — but a
--    *composite* index surviving on just the remaining column would violate uniqueness
--    (multiple Commissions share the same `source`), so Commission_dealId_source_key
--    must be dropped explicitly first rather than relying on that auto-drop.
ALTER TABLE `ListingImage` DROP COLUMN `listingId`;
ALTER TABLE `Deal` DROP COLUMN `listingId`;
ALTER TABLE `DeveloperRequest` DROP COLUMN `listingId`;
ALTER TABLE `Booking` DROP COLUMN `dealId`;
ALTER TABLE `Commission` DROP INDEX `Commission_dealId_source_key`;
ALTER TABLE `Commission` DROP COLUMN `dealId`;

-- 3. Cut over each table's own primary key: drop the old string PK, rename the numeric
--    shadow column into place as an AUTO_INCREMENT primary key, and set the next
--    auto-increment value to one past the highest id the backfill assigned so new rows
--    can't collide with backfilled ones.
ALTER TABLE `Listing` DROP PRIMARY KEY;
ALTER TABLE `Listing` DROP COLUMN `id`;
ALTER TABLE `Listing` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `Listing` AUTO_INCREMENT = 12;

ALTER TABLE `ListingImage` DROP PRIMARY KEY;
ALTER TABLE `ListingImage` DROP COLUMN `id`;
ALTER TABLE `ListingImage` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `ListingImage` AUTO_INCREMENT = 3;

ALTER TABLE `Deal` DROP PRIMARY KEY;
ALTER TABLE `Deal` DROP COLUMN `id`;
ALTER TABLE `Deal` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `Deal` AUTO_INCREMENT = 15;

ALTER TABLE `Booking` DROP PRIMARY KEY;
ALTER TABLE `Booking` DROP COLUMN `id`;
ALTER TABLE `Booking` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `Booking` AUTO_INCREMENT = 5;

ALTER TABLE `Commission` DROP PRIMARY KEY;
ALTER TABLE `Commission` DROP COLUMN `id`;
ALTER TABLE `Commission` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `Commission` AUTO_INCREMENT = 5;

ALTER TABLE `DeveloperRequest` DROP PRIMARY KEY;
ALTER TABLE `DeveloperRequest` DROP COLUMN `id`;
ALTER TABLE `DeveloperRequest` CHANGE COLUMN `numericId` `id` INT NOT NULL AUTO_INCREMENT, ADD PRIMARY KEY (`id`);
ALTER TABLE `DeveloperRequest` AUTO_INCREMENT = 4;

-- 4. Rename every shadow FK column to its final name, with the correct nullability.
ALTER TABLE `ListingImage` CHANGE COLUMN `listingNumericId` `listingId` INT NOT NULL;
ALTER TABLE `Deal` CHANGE COLUMN `listingNumericId` `listingId` INT NOT NULL;
ALTER TABLE `DeveloperRequest` CHANGE COLUMN `listingNumericId` `listingId` INT NOT NULL;
ALTER TABLE `Booking` CHANGE COLUMN `dealNumericId` `dealId` INT NOT NULL;
ALTER TABLE `Commission` CHANGE COLUMN `dealNumericId` `dealId` INT NOT NULL;

-- 5. Re-create indexes matching the original schema shape.
ALTER TABLE `ListingImage` ADD INDEX `ListingImage_listingId_idx` (`listingId`);
ALTER TABLE `Deal` ADD INDEX `Deal_listingId_idx` (`listingId`);
ALTER TABLE `DeveloperRequest` ADD INDEX `DeveloperRequest_listingId_idx` (`listingId`);
ALTER TABLE `Booking` ADD UNIQUE INDEX `Booking_dealId_key` (`dealId`);
ALTER TABLE `Commission` ADD INDEX `Commission_dealId_idx` (`dealId`);
ALTER TABLE `Commission` ADD UNIQUE INDEX `Commission_dealId_source_key` (`dealId`, `source`);

-- 6. Re-add FK constraints, now pointing at the Int primary keys (all CASCADE/CASCADE,
--    matching what was live before this migration).
ALTER TABLE `ListingImage` ADD CONSTRAINT `ListingImage_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `Listing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `Listing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `Listing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
