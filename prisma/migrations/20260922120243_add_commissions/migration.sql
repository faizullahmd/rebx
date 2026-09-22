-- CreateTable
CREATE TABLE `Commission` (
    `id` VARCHAR(191) NOT NULL,
    `source` ENUM('DEVELOPER', 'CUSTOMER') NOT NULL,
    `status` ENUM('PENDING', 'INVOICED', 'RECEIVED') NOT NULL DEFAULT 'PENDING',
    `amount` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `dealId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(191) NOT NULL,
    `invoicedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Commission_dealId_idx`(`dealId`),
    INDEX `Commission_agentId_idx`(`agentId`),
    INDEX `Commission_status_idx`(`status`),
    UNIQUE INDEX `Commission_dealId_source_key`(`dealId`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
