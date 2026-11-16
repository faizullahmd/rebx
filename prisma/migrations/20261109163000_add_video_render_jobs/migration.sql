-- CreateTable
CREATE TABLE `VideoRenderJob` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `createdById` INTEGER NULL,
    `status` ENUM('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `stage` VARCHAR(120) NULL,
    `errorMessage` TEXT NULL,
    `snapshot` JSON NOT NULL,
    `snapshotHash` VARCHAR(64) NOT NULL,
    `outputStorageKey` VARCHAR(500) NULL,
    `outputMetadata` JSON NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VideoRenderJob_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `VideoRenderJob_projectId_status_idx`(`projectId`, `status`),
    INDEX `VideoRenderJob_projectId_snapshotHash_status_idx`(`projectId`, `snapshotHash`, `status`),
    INDEX `VideoRenderJob_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `VideoRenderJob_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VideoRenderJob` ADD CONSTRAINT `VideoRenderJob_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `VideoProject`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoRenderJob` ADD CONSTRAINT `VideoRenderJob_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

