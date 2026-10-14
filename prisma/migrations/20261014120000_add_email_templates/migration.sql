-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `subject` VARCHAR(191) NOT NULL,
    `htmlBody` LONGTEXT NOT NULL,
    `textBody` LONGTEXT NULL,
    `fromName` VARCHAR(191) NULL,
    `fromEmail` VARCHAR(191) NULL,
    `replyTo` VARCHAR(191) NULL,
    `cc` TEXT NULL,
    `bcc` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplate_key_key`(`key`),
    INDEX `EmailTemplate_category_idx`(`category`),
    INDEX `EmailTemplate_status_idx`(`status`),
    INDEX `EmailTemplate_event_idx`(`event`),
    INDEX `EmailTemplate_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplateDraft` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `baseVersion` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `htmlBody` LONGTEXT NOT NULL,
    `textBody` LONGTEXT NULL,
    `fromName` VARCHAR(191) NULL,
    `fromEmail` VARCHAR(191) NULL,
    `replyTo` VARCHAR(191) NULL,
    `cc` TEXT NULL,
    `bcc` TEXT NULL,
    `updatedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplateDraft_templateId_key`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplateVersion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `action` ENUM('SEED', 'CREATE', 'PUBLISH', 'RESTORE') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `htmlBody` LONGTEXT NOT NULL,
    `textBody` LONGTEXT NULL,
    `fromName` VARCHAR(191) NULL,
    `fromEmail` VARCHAR(191) NULL,
    `replyTo` VARCHAR(191) NULL,
    `cc` TEXT NULL,
    `bcc` TEXT NULL,
    `changeSummary` TEXT NULL,
    `restoredFromVersion` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailTemplateVersion_templateId_createdAt_idx`(`templateId`, `createdAt`),
    UNIQUE INDEX `EmailTemplateVersion_templateId_version_key`(`templateId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTestLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NULL,
    `templateKey` VARCHAR(191) NOT NULL,
    `templateVersion` INTEGER NOT NULL,
    `usedDraft` BOOLEAN NOT NULL DEFAULT false,
    `recipient` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `status` ENUM('SENT', 'FAILED') NOT NULL,
    `error` TEXT NULL,
    `sentById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailTestLog_templateId_createdAt_idx`(`templateId`, `createdAt`),
    INDEX `EmailTestLog_sentById_createdAt_idx`(`sentById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `actorEmail` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AdminAuditLog_createdAt_idx`(`createdAt`),
    INDEX `AdminAuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplateDraft` ADD CONSTRAINT `EmailTemplateDraft_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `EmailTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplateDraft` ADD CONSTRAINT `EmailTemplateDraft_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplateVersion` ADD CONSTRAINT `EmailTemplateVersion_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `EmailTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplateVersion` ADD CONSTRAINT `EmailTemplateVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTestLog` ADD CONSTRAINT `EmailTestLog_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `EmailTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTestLog` ADD CONSTRAINT `EmailTestLog_sentById_fkey` FOREIGN KEY (`sentById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAuditLog` ADD CONSTRAINT `AdminAuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

