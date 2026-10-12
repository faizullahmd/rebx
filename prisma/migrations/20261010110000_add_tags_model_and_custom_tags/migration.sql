-- CreateTable
CREATE TABLE `Tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Tag_createdBy_idx`(`createdBy`),
    INDEX `Tag_isDefault_idx`(`isDefault`),
    UNIQUE INDEX `Tag_createdBy_name_key`(`createdBy`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `tagId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Listing_tagId_idx` ON `Listing`(`tagId`);

-- AddForeignKey
ALTER TABLE `Listing` ADD CONSTRAINT `Listing_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed Default Tags
INSERT INTO `Tag` (`name`, `color`, `isDefault`, `createdBy`, `createdAt`) VALUES
('Featured', 'purple', true, NULL, CURRENT_TIMESTAMP(3)),
('Few Units Left', 'amber', true, NULL, CURRENT_TIMESTAMP(3)),
('Most Viewed', 'blue', true, NULL, CURRENT_TIMESTAMP(3)),
('New', 'emerald', true, NULL, CURRENT_TIMESTAMP(3)),
('Exclusive', 'indigo', true, NULL, CURRENT_TIMESTAMP(3));

-- Migrate existing hardcoded tags to seeded default tag IDs
UPDATE `Listing`
SET `tagId` = (SELECT `id` FROM `Tag` WHERE `name` = 'Featured' AND `isDefault` = true LIMIT 1)
WHERE `tags` IS NOT NULL AND (`tags` LIKE '%featured%' OR `tags` LIKE '%Featured%');

UPDATE `Listing`
SET `tagId` = (SELECT `id` FROM `Tag` WHERE `name` = 'Few Units Left' AND `isDefault` = true LIMIT 1)
WHERE `tags` IS NOT NULL AND (`tags` LIKE '%few_units_left%' OR `tags` LIKE '%Few Units Left%');

UPDATE `Listing`
SET `tagId` = (SELECT `id` FROM `Tag` WHERE `name` = 'Most Viewed' AND `isDefault` = true LIMIT 1)
WHERE `tags` IS NOT NULL AND (`tags` LIKE '%most_viewed%' OR `tags` LIKE '%Most Viewed%');

UPDATE `Listing`
SET `tagId` = (SELECT `id` FROM `Tag` WHERE `name` = 'New' AND `isDefault` = true LIMIT 1)
WHERE `tags` IS NOT NULL AND (`tags` LIKE '%new%' OR `tags` LIKE '%New%');

UPDATE `Listing`
SET `tagId` = (SELECT `id` FROM `Tag` WHERE `name` = 'Exclusive' AND `isDefault` = true LIMIT 1)
WHERE `tags` IS NOT NULL AND (`tags` LIKE '%exclusive%' OR `tags` LIKE '%Exclusive%');
