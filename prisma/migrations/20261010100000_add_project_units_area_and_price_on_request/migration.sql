-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `priceOnRequest` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `projectArea` DECIMAL(8, 2) NULL,
    ADD COLUMN `projectUnits` INTEGER NULL,
    MODIFY `price` DECIMAL(12, 2) NULL;
