-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `availability` ENUM('READY_TO_MOVE', 'UNDER_CONSTRUCTION') NULL,
    ADD COLUMN `facing` ENUM('NORTH', 'SOUTH', 'EAST', 'WEST', 'NORTH_EAST', 'NORTH_WEST', 'SOUTH_EAST', 'SOUTH_WEST') NULL,
    ADD COLUMN `furnishing` ENUM('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED') NULL,
    ADD COLUMN `parkingSpots` INTEGER NULL,
    ADD COLUMN `propertyAgeYears` INTEGER NULL,
    ADD COLUMN `propertyCategory` ENUM('RESIDENTIAL', 'COMMERCIAL', 'LAND_PLOT', 'INDUSTRIAL') NULL,
    ADD COLUMN `propertyType` ENUM('APARTMENT', 'VILLA', 'INDEPENDENT_HOUSE', 'BUILDER_FLOOR', 'PENTHOUSE', 'STUDIO', 'OFFICE', 'SHOP', 'SHOWROOM', 'WAREHOUSE', 'RESIDENTIAL_PLOT', 'COMMERCIAL_PLOT', 'AGRICULTURAL_LAND', 'FACTORY', 'INDUSTRIAL_BUILDING', 'INDUSTRIAL_LAND') NULL,
    ADD COLUMN `transactionType` ENUM('FOR_SALE', 'FOR_RENT', 'FOR_LEASE', 'AUCTION') NOT NULL DEFAULT 'FOR_SALE';

-- CreateIndex
CREATE INDEX `Listing_transactionType_idx` ON `Listing`(`transactionType`);

-- CreateIndex
CREATE INDEX `Listing_propertyCategory_idx` ON `Listing`(`propertyCategory`);

-- CreateIndex
CREATE INDEX `Listing_propertyType_idx` ON `Listing`(`propertyType`);
