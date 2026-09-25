-- Cutover User.id (and every FK referencing it) from String cuid to Int, using the
-- shadow numeric columns populated by scripts/backfill-user-ids.ts. Must only be run
-- after that script has confirmed zero orphans (see its assertNoOrphans check).

-- 1. Drop every FK constraint pointing at User.id (required before the columns they're
--    on, and User's own primary key, can be dropped).
ALTER TABLE `AgentProfile` DROP FOREIGN KEY `AgentProfile_userId_fkey`;
ALTER TABLE `DeveloperProfile` DROP FOREIGN KEY `DeveloperProfile_userId_fkey`;
ALTER TABLE `CustomerProfile` DROP FOREIGN KEY `CustomerProfile_userId_fkey`;
ALTER TABLE `Listing` DROP FOREIGN KEY `Listing_agentId_fkey`;
ALTER TABLE `Listing` DROP FOREIGN KEY `Listing_developerId_fkey`;
ALTER TABLE `Deal` DROP FOREIGN KEY `Deal_agentId_fkey`;
ALTER TABLE `Deal` DROP FOREIGN KEY `Deal_customerId_fkey`;
ALTER TABLE `Commission` DROP FOREIGN KEY `Commission_agentId_fkey`;
ALTER TABLE `Commission` DROP FOREIGN KEY `Commission_paidOutById_fkey`;
ALTER TABLE `PasswordResetToken` DROP FOREIGN KEY `PasswordResetToken_userId_fkey`;
ALTER TABLE `DeveloperRequest` DROP FOREIGN KEY `DeveloperRequest_requestedById_fkey`;
ALTER TABLE `DeveloperRequest` DROP FOREIGN KEY `DeveloperRequest_createdDeveloperId_fkey`;

-- 2. Drop the old String id/FK columns. MySQL auto-drops any index that lives solely on
--    a dropped column, so this also removes the old *_idx / *_key indexes.
ALTER TABLE `AgentProfile` DROP COLUMN `userId`;
ALTER TABLE `DeveloperProfile` DROP COLUMN `userId`;
ALTER TABLE `CustomerProfile` DROP COLUMN `userId`;
ALTER TABLE `Listing` DROP COLUMN `agentId`;
ALTER TABLE `Listing` DROP COLUMN `developerId`;
ALTER TABLE `Deal` DROP COLUMN `agentId`;
ALTER TABLE `Deal` DROP COLUMN `customerId`;
ALTER TABLE `Commission` DROP COLUMN `agentId`;
ALTER TABLE `Commission` DROP COLUMN `paidOutById`;
ALTER TABLE `PasswordResetToken` DROP COLUMN `userId`;
ALTER TABLE `DeveloperRequest` DROP COLUMN `requestedById`;
ALTER TABLE `DeveloperRequest` DROP COLUMN `createdDeveloperId`;

-- 3. Cut over User itself: drop the old String primary key and its numericId unique
--    index (PRIMARY KEY will enforce uniqueness once numericId is renamed to id), then
--    rename numericId -> id and make it the primary key.
ALTER TABLE `User` DROP PRIMARY KEY;
ALTER TABLE `User` DROP INDEX `User_numericId_key`;
ALTER TABLE `User` DROP COLUMN `id`;
ALTER TABLE `User` CHANGE COLUMN `numericId` `id` INT NOT NULL;
ALTER TABLE `User` ADD PRIMARY KEY (`id`);

-- 4. Rename every shadow column to its final name, with the correct nullability.
ALTER TABLE `AgentProfile` CHANGE COLUMN `userNumericId` `userId` INT NOT NULL;
ALTER TABLE `DeveloperProfile` CHANGE COLUMN `userNumericId` `userId` INT NOT NULL;
ALTER TABLE `CustomerProfile` CHANGE COLUMN `userNumericId` `userId` INT NOT NULL;
ALTER TABLE `Listing` CHANGE COLUMN `agentNumericId` `agentId` INT NOT NULL;
ALTER TABLE `Listing` CHANGE COLUMN `developerNumericId` `developerId` INT NULL;
ALTER TABLE `Deal` CHANGE COLUMN `agentNumericId` `agentId` INT NOT NULL;
ALTER TABLE `Deal` CHANGE COLUMN `customerNumericId` `customerId` INT NULL;
ALTER TABLE `Commission` CHANGE COLUMN `agentNumericId` `agentId` INT NOT NULL;
ALTER TABLE `Commission` CHANGE COLUMN `paidOutByNumericId` `paidOutById` INT NULL;
ALTER TABLE `PasswordResetToken` CHANGE COLUMN `userNumericId` `userId` INT NOT NULL;
ALTER TABLE `DeveloperRequest` CHANGE COLUMN `requestedByNumericId` `requestedById` INT NOT NULL;
ALTER TABLE `DeveloperRequest` CHANGE COLUMN `createdDeveloperNumericId` `createdDeveloperId` INT NULL;

-- 5. Re-create unique/regular indexes matching the original schema shape.
ALTER TABLE `AgentProfile` ADD UNIQUE INDEX `AgentProfile_userId_key` (`userId`);
ALTER TABLE `DeveloperProfile` ADD UNIQUE INDEX `DeveloperProfile_userId_key` (`userId`);
ALTER TABLE `CustomerProfile` ADD UNIQUE INDEX `CustomerProfile_userId_key` (`userId`);
ALTER TABLE `Listing` ADD INDEX `Listing_agentId_idx` (`agentId`);
ALTER TABLE `Listing` ADD INDEX `Listing_developerId_idx` (`developerId`);
ALTER TABLE `Deal` ADD INDEX `Deal_agentId_idx` (`agentId`);
ALTER TABLE `Deal` ADD INDEX `Deal_customerId_idx` (`customerId`);
ALTER TABLE `Commission` ADD INDEX `Commission_agentId_idx` (`agentId`);
ALTER TABLE `PasswordResetToken` ADD INDEX `PasswordResetToken_userId_idx` (`userId`);
ALTER TABLE `DeveloperRequest` ADD INDEX `DeveloperRequest_requestedById_idx` (`requestedById`);

-- 6. Re-add FK constraints, now pointing at the Int User.id.
ALTER TABLE `AgentProfile` ADD CONSTRAINT `AgentProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DeveloperProfile` ADD CONSTRAINT `DeveloperProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CustomerProfile` ADD CONSTRAINT `CustomerProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Listing` ADD CONSTRAINT `Listing_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Listing` ADD CONSTRAINT `Listing_developerId_fkey` FOREIGN KEY (`developerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_paidOutById_fkey` FOREIGN KEY (`paidOutById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_createdDeveloperId_fkey` FOREIGN KEY (`createdDeveloperId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
