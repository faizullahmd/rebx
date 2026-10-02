-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `reraId` VARCHAR(191) NULL;
ALTER TABLE `Listing` ADD COLUMN `avgPricePerSqFt` VARCHAR(191) NULL;
ALTER TABLE `Listing` ADD COLUMN `possessionStarts` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Review` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NULL DEFAULT 'Verified Buyer',
    `rating` INTEGER NOT NULL DEFAULT 5,
    `comment` TEXT NOT NULL,
    `communicationRating` DOUBLE NULL,
    `localKnowledgeRating` DOUBLE NULL,
    `negotiationRating` DOUBLE NULL,
    `isVerified` BOOLEAN NOT NULL DEFAULT true,
    `agentId` INTEGER NOT NULL,
    `listingId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Review_agentId_idx`(`agentId`),
    INDEX `Review_listingId_idx`(`listingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `Listing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
