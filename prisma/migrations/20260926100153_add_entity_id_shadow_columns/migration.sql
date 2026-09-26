-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `dealNumericId` INTEGER NULL,
    ADD COLUMN `numericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Commission` ADD COLUMN `dealNumericId` INTEGER NULL,
    ADD COLUMN `numericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Deal` ADD COLUMN `listingNumericId` INTEGER NULL,
    ADD COLUMN `numericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `DeveloperRequest` ADD COLUMN `listingNumericId` INTEGER NULL,
    ADD COLUMN `numericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `numericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ListingImage` ADD COLUMN `listingNumericId` INTEGER NULL,
    ADD COLUMN `numericId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Booking_numericId_key` ON `Booking`(`numericId`);

-- CreateIndex
CREATE UNIQUE INDEX `Booking_dealNumericId_key` ON `Booking`(`dealNumericId`);

-- CreateIndex
CREATE UNIQUE INDEX `Commission_numericId_key` ON `Commission`(`numericId`);

-- CreateIndex
CREATE UNIQUE INDEX `Deal_numericId_key` ON `Deal`(`numericId`);

-- CreateIndex
CREATE UNIQUE INDEX `DeveloperRequest_numericId_key` ON `DeveloperRequest`(`numericId`);

-- CreateIndex
CREATE UNIQUE INDEX `Listing_numericId_key` ON `Listing`(`numericId`);

-- CreateIndex
CREATE UNIQUE INDEX `ListingImage_numericId_key` ON `ListingImage`(`numericId`);
