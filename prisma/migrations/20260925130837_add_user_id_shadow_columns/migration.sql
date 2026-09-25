-- AlterTable
ALTER TABLE `AgentProfile` ADD COLUMN `userNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Commission` ADD COLUMN `agentNumericId` INTEGER NULL,
    ADD COLUMN `paidOutByNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `CustomerProfile` ADD COLUMN `userNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Deal` ADD COLUMN `agentNumericId` INTEGER NULL,
    ADD COLUMN `customerNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `DeveloperProfile` ADD COLUMN `userNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `DeveloperRequest` ADD COLUMN `createdDeveloperNumericId` INTEGER NULL,
    ADD COLUMN `requestedByNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Listing` ADD COLUMN `agentNumericId` INTEGER NULL,
    ADD COLUMN `developerNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `PasswordResetToken` ADD COLUMN `userNumericId` INTEGER NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `numericId` INTEGER NULL;

-- CreateTable
CREATE TABLE `IdCounter` (
    `key` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `AgentProfile_userNumericId_key` ON `AgentProfile`(`userNumericId`);

-- CreateIndex
CREATE UNIQUE INDEX `CustomerProfile_userNumericId_key` ON `CustomerProfile`(`userNumericId`);

-- CreateIndex
CREATE UNIQUE INDEX `DeveloperProfile_userNumericId_key` ON `DeveloperProfile`(`userNumericId`);

-- CreateIndex
CREATE UNIQUE INDEX `User_numericId_key` ON `User`(`numericId`);
