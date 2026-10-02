-- AlterTable
ALTER TABLE `User` ADD COLUMN `username` VARCHAR(191) NULL;

-- Backfill existing users with unique slugified lowercase usernames based on their name
UPDATE `User` SET `username` = LOWER(REPLACE(REPLACE(TRIM(`name`), ' ', '-'), '.', '')) WHERE `username` IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);
