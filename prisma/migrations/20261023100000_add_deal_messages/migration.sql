-- CreateTable
CREATE TABLE `DealMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dealId` INTEGER NOT NULL,
    `senderRole` ENUM('AGENT', 'CUSTOMER', 'SYSTEM') NOT NULL,
    `senderId` INTEGER NULL,
    `type` ENUM('MESSAGE', 'OFFER', 'NOTE', 'EVENT') NOT NULL DEFAULT 'MESSAGE',
    `text` TEXT NOT NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `offerStatus` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED', 'EXPIRED') NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `agentReadAt` DATETIME(3) NULL,
    `customerReadAt` DATETIME(3) NULL,
    INDEX `DealMessage_dealId_idx`(`dealId`),
    INDEX `DealMessage_senderId_idx`(`senderId`),
    INDEX `DealMessage_type_idx`(`type`),
    INDEX `DealMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DealMessage` ADD CONSTRAINT `DealMessage_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealMessage` ADD CONSTRAINT `DealMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
