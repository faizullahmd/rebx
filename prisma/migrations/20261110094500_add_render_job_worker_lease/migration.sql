-- AlterTable
ALTER TABLE `VideoRenderJob`
    ADD COLUMN `workerId` VARCHAR(120) NULL,
    ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `lastHeartbeatAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `VideoRenderJob_status_leaseExpiresAt_idx` ON `VideoRenderJob`(`status`, `leaseExpiresAt`);

