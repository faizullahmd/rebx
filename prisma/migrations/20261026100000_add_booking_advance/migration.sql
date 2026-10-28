-- CreateTable
CREATE TABLE `BookingAdvance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookingId` INTEGER NOT NULL,
    `dealId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `percentUsed` DECIMAL(5, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` ENUM('PENDING', 'PAID') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `markedPaidBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BookingAdvance_bookingId_key`(`bookingId`),
    INDEX `BookingAdvance_dealId_idx`(`dealId`),
    INDEX `BookingAdvance_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingAdvanceHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `advanceId` INTEGER NOT NULL,
    `action` ENUM('CREATED', 'AMOUNT_EDITED', 'MARKED_PAID', 'UNMARKED_PAID') NOT NULL,
    `oldValue` TEXT NULL,
    `newValue` TEXT NULL,
    `reason` TEXT NULL,
    `actorId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingAdvanceHistory_advanceId_idx`(`advanceId`),
    INDEX `BookingAdvanceHistory_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BookingAdvance` ADD CONSTRAINT `BookingAdvance_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingAdvance` ADD CONSTRAINT `BookingAdvance_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingAdvance` ADD CONSTRAINT `BookingAdvance_markedPaidBy_fkey` FOREIGN KEY (`markedPaidBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingAdvanceHistory` ADD CONSTRAINT `BookingAdvanceHistory_advanceId_fkey` FOREIGN KEY (`advanceId`) REFERENCES `BookingAdvance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingAdvanceHistory` ADD CONSTRAINT `BookingAdvanceHistory_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
