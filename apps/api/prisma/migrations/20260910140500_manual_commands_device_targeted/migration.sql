-- CDC_APV2_COMMANDES_MANUELLES_RASPBERRY_LOGO : commandes manuelles depuis
-- l'admin, ciblant directement un device (porte/éclairage du club), pas
-- une zone. `access_commands` doit être vide au moment de cette migration
-- (Phase 1 dev-only, aucune donnée réelle) : les anciens types de commande
-- spéculatifs (OPEN_DOOR_PULSE, LIGHT_OVERRIDE_ON/OFF, CLEAR_LIGHT_OVERRIDE)
-- sont remplacés par le vocabulaire réel validé sur le POC matériel.

-- 1) AccessCommandType : recréation (Postgres ne permet pas de retirer des
--    valeurs d'un enum existant).
CREATE TYPE "AccessCommandType_new" AS ENUM ('DOOR_OPEN', 'DOOR_CLOSE', 'LIGHT_ON', 'LIGHT_OFF');
ALTER TABLE "access_commands" ALTER COLUMN "type" TYPE "AccessCommandType_new" USING (type::text::"AccessCommandType_new");
ALTER TYPE "AccessCommandType" RENAME TO "AccessCommandType_old";
ALTER TYPE "AccessCommandType_new" RENAME TO "AccessCommandType";
DROP TYPE "AccessCommandType_old";

-- 2) AccessCommandStatus : ajout de FAILED (distinct de SUCCESS, pour
--    refléter un ACK Raspberry qui rapporte un échec d'exécution locale).
ALTER TYPE "AccessCommandStatus" ADD VALUE IF NOT EXISTS 'FAILED';

-- 3) zone_id devient optionnel : une commande manuelle cible un device
--    directement, sans zone.
ALTER TABLE "access_commands" ALTER COLUMN "zone_id" DROP NOT NULL;

-- 4) Résultat rapporté par le Raspberry à l'ACK.
ALTER TABLE "access_commands" ADD COLUMN "result" TEXT;

-- 5) Index pour la résolution des commandes éligibles par device (en plus
--    de l'index existant par zone).
CREATE INDEX "access_commands_device_id_status_idx" ON "access_commands"("device_id", "status");
