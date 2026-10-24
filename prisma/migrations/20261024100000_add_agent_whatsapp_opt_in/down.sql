-- Reverts 20261024100000_add_agent_whatsapp_opt_in.
ALTER TABLE `AgentProfile` DROP COLUMN `whatsappOptIn`;
