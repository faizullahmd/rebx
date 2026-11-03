-- CreateTable
CREATE TABLE `shortlist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `listing_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shortlist_customer_id_idx`(`customer_id`),
    INDEX `shortlist_listing_id_idx`(`listing_id`),
    UNIQUE INDEX `shortlist_customer_id_listing_id_key`(`customer_id`, `listing_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shortlist` ADD CONSTRAINT `shortlist_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shortlist` ADD CONSTRAINT `shortlist_listing_id_fkey` FOREIGN KEY (`listing_id`) REFERENCES `Listing`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

