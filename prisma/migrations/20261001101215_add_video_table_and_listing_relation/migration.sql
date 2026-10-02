-- AlterTable
ALTER TABLE `listing` ADD COLUMN `videoId` INTEGER NULL;

-- CreateTable
CREATE TABLE `Video` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `videoId` VARCHAR(191) NOT NULL,
    `thumbnailUrl` TEXT NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Video_createdById_idx`(`createdById`),
    UNIQUE INDEX `Video_provider_videoId_key`(`provider`, `videoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Listing_videoId_idx` ON `Listing`(`videoId`);

-- AddForeignKey
ALTER TABLE `Listing` ADD CONSTRAINT `Listing_videoId_fkey` FOREIGN KEY (`videoId`) REFERENCES `Video`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Video` ADD CONSTRAINT `Video_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
