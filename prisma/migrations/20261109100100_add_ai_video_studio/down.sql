-- Manual rollback for 20261109100100_add_ai_video_studio (Prisma does not run this file).
-- Drops Video Studio tables in foreign-key dependency order. Back up first.
-- Afterwards run: prisma migrate resolve --rolled-back 20261109100100_add_ai_video_studio
DROP TABLE IF EXISTS `VideoVersion`;
DROP TABLE IF EXISTS `VideoScene`;
DROP TABLE IF EXISTS `VideoProject`;

