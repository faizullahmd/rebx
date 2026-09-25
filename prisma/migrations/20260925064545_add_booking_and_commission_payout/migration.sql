-- AlterTable
ALTER TABLE `Commission` ADD COLUMN `paidOutAt` DATETIME(3) NULL,
    ADD COLUMN `paidOutById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Booking` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING_CONFIRMATION', 'CONFIRMED') NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    `bookingNumber` VARCHAR(191) NULL,
    `unitNumber` VARCHAR(191) NULL,
    `saleAmount` DECIMAL(12, 2) NOT NULL,
    `bookingDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `dealId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Booking_dealId_key`(`dealId`),
    INDEX `Booking_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Commission` ADD CONSTRAINT `Commission_paidOutById_fkey` FOREIGN KEY (`paidOutById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
