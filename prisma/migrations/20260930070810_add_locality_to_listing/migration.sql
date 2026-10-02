-- DropIndex
DROP INDEX `Booking_numericId_key` ON `booking`;

-- DropIndex
DROP INDEX `Commission_numericId_key` ON `commission`;

-- DropIndex
DROP INDEX `Deal_numericId_key` ON `deal`;

-- DropIndex
DROP INDEX `DeveloperRequest_numericId_key` ON `developerrequest`;

-- DropIndex
DROP INDEX `Listing_numericId_key` ON `listing`;

-- DropIndex
DROP INDEX `ListingImage_numericId_key` ON `listingimage`;

-- AlterTable
ALTER TABLE `listing` ADD COLUMN `locality` VARCHAR(191) NULL;
