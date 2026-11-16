-- CreateTable
CREATE TABLE `VideoProject` (
    `id` VARCHAR(191) NOT NULL,
    `schemaVersion` VARCHAR(191) NOT NULL DEFAULT '1.0.0',
    `title` VARCHAR(255) NOT NULL,
    `topic` TEXT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'property_showcase',
    `contentType` VARCHAR(191) NULL DEFAULT 'property_showcase',
    `status` ENUM('DRAFT', 'PROCESSING', 'COMPLETED', 'FAILED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `sourceType` ENUM('CUSTOM_SCRIPT', 'EXISTING_CONTENT', 'CONTENT_IDEAS', 'BRIEF', 'REBX_CONTENT') NOT NULL DEFAULT 'CUSTOM_SCRIPT',
    `sourceRefType` VARCHAR(191) NULL,
    `sourceRefId` VARCHAR(191) NULL,
    `targetAudience` VARCHAR(191) NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'English',
    `tone` VARCHAR(191) NOT NULL DEFAULT 'Professional',
    `duration` INTEGER NOT NULL DEFAULT 60,
    `aspectRatio` VARCHAR(191) NOT NULL DEFAULT '16:9',
    `resolution` VARCHAR(191) NOT NULL DEFAULT '1920x1080',
    `brief` JSON NULL,
    `summary` TEXT NULL,
    `targetRatios` JSON NULL,
    `metadata` JSON NULL,
    `createdById` INTEGER NOT NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VideoProject_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `VideoProject_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoScene` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(255) NOT NULL,
    `narration` TEXT NOT NULL,
    `onScreenText` VARCHAR(255) NULL,
    `imagePrompt` TEXT NOT NULL,
    `imageUrl` TEXT NULL,
    `imagePath` TEXT NULL,
    `duration` INTEGER NOT NULL DEFAULT 6,
    `durationSec` INTEGER NOT NULL DEFAULT 6,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoScene_projectId_order_idx`(`projectId`, `order`),
    INDEX `VideoScene_projectId_position_idx`(`projectId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoVersion` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoVersion_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VideoProject` ADD CONSTRAINT `VideoProject_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoScene` ADD CONSTRAINT `VideoScene_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `VideoProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoVersion` ADD CONSTRAINT `VideoVersion_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `VideoProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

