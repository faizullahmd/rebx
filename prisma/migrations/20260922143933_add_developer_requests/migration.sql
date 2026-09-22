-- CreateTable
CREATE TABLE `DeveloperRequest` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `companyName` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NOT NULL,
    `contactEmail` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL,
    `rejectionReason` TEXT NULL,
    `listingId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `createdDeveloperId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DeveloperRequest_listingId_idx`(`listingId`),
    INDEX `DeveloperRequest_requestedById_idx`(`requestedById`),
    INDEX `DeveloperRequest_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `Listing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeveloperRequest` ADD CONSTRAINT `DeveloperRequest_createdDeveloperId_fkey` FOREIGN KEY (`createdDeveloperId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
