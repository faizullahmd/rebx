-- AlterTable
ALTER TABLE `SiteVisit`
    ADD COLUMN `reminded24hAt` DATETIME(3) NULL,
    ADD COLUMN `reminded1hAt` DATETIME(3) NULL;
