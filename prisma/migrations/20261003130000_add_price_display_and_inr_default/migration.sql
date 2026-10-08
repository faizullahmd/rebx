-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `priceDisplay` VARCHAR(191) NULL,
    MODIFY `currency` VARCHAR(191) NOT NULL DEFAULT 'INR';
