-- ─────────────────────────────────────────────────────────────────────────────
-- A-2a multi-system foundation migration
-- Adapted from `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel`
-- with DROP+CREATE pairs converted to ALTER ... RENAME and backfill UPDATEs added.
--
-- Wrap the whole thing in a transaction so a partial failure rolls back cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. New tables ──────────────────────────────────────────────────────────
CREATE TABLE "enterprise_systems" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enterprise_systems_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "enterprise_systems_code_key" ON "enterprise_systems"("code");

CREATE TABLE "customer_systems" (
    "customer_id" TEXT NOT NULL,
    "system_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_systems_pkey" PRIMARY KEY ("customer_id","system_id")
);
CREATE INDEX "customer_systems_system_id_idx" ON "customer_systems"("system_id");

CREATE TABLE "classifier_configs" (
    "id" TEXT NOT NULL,
    "system_id" TEXT NOT NULL,
    "modules" TEXT[],
    "sub_module_convention" TEXT,
    "system_prompt" TEXT NOT NULL,
    "few_shot_examples" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "classifier_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "classifier_configs_system_id_key" ON "classifier_configs"("system_id");

-- ── 2. Seed enterprise_systems rows ────────────────────────────────────────
INSERT INTO "enterprise_systems" ("id", "code", "name") VALUES
    ('11111111-1111-4111-8111-000000000001', 'sap',         'SAP S/4HANA'),
    ('11111111-1111-4111-8111-000000000002', 'netsuite',    'NetSuite'),
    ('11111111-1111-4111-8111-000000000003', 'oracle_ebs',  'Oracle E-Business Suite'),
    ('11111111-1111-4111-8111-000000000004', 'salesforce',  'Salesforce'),
    ('11111111-1111-4111-8111-000000000005', 'workday',     'Workday');

-- ── 3. Seed classifier_configs for SAP ─────────────────────────────────────
INSERT INTO "classifier_configs"
    ("id", "system_id", "modules", "sub_module_convention", "system_prompt", "version", "updated_at")
VALUES (
    gen_random_uuid()::text,
    '11111111-1111-4111-8111-000000000001',
    ARRAY['FICO','MM','SD','PP','BASIS','OTHER'],
    'AP/AR/GL for FICO; PUR/IM for MM; PR/PRC for SD; MRP/PO for PP; AUTH/TRANSPORT for BASIS',
    'You classify SAP AMS support tickets. Return only structured JSON via the classify_ticket tool. Module values are limited to FICO, MM, SD, PP, BASIS, OTHER. Sub-module follows SAP convention (AP/AR/GL for FICO; PUR/IM for MM; PR/PRC for SD; MRP/PO for PP). Business impact considers urgency cues like deadlines, blockers, and monetary scale — not the user-set priority.',
    1,
    CURRENT_TIMESTAMP
);

-- ── 4. Drop old FKs that point at sap_*_id columns (so we can rename) ──────
ALTER TABLE "agent_specializations" DROP CONSTRAINT "agent_specializations_sap_module_id_fkey";
ALTER TABLE "assignment_rules"      DROP CONSTRAINT "assignment_rules_sap_module_id_fkey";
ALTER TABLE "itsm_records"          DROP CONSTRAINT "itsm_records_sap_module_id_fkey";
ALTER TABLE "itsm_records"          DROP CONSTRAINT "itsm_records_sap_sub_module_id_fkey";
ALTER TABLE "sap_module_masters"    DROP CONSTRAINT "sap_module_masters_tenant_id_fkey";
ALTER TABLE "sap_sub_module_masters" DROP CONSTRAINT "sap_sub_module_masters_module_id_fkey";
ALTER TABLE "sap_sub_module_masters" DROP CONSTRAINT "sap_sub_module_masters_tenant_id_fkey";

-- Drop old unique on agent_specializations (column it references is being renamed)
DROP INDEX "agent_specializations_agent_id_sap_module_id_key";

-- ── 5. Rename tables: sap_module_masters → module_masters ──────────────────
ALTER TABLE "sap_module_masters" RENAME TO "module_masters";
-- Rename indexes/keys that the old table owned
ALTER INDEX "sap_module_masters_pkey"            RENAME TO "module_masters_pkey";
ALTER INDEX "sap_module_masters_tenant_id_idx"   RENAME TO "module_masters_tenant_id_idx";
ALTER INDEX "sap_module_masters_tenant_id_code_key" RENAME TO "module_masters_tenant_id_code_key_old";

-- Add system_id column (nullable) + backfill + NOT NULL
ALTER TABLE "module_masters" ADD COLUMN "system_id" TEXT;
UPDATE "module_masters" SET "system_id" = '11111111-1111-4111-8111-000000000001';
ALTER TABLE "module_masters" ALTER COLUMN "system_id" SET NOT NULL;

-- New (tenant_id, system_id, code) unique index replaces (tenant_id, code)
DROP INDEX "module_masters_tenant_id_code_key_old";
CREATE UNIQUE INDEX "module_masters_tenant_id_system_id_code_key"
    ON "module_masters"("tenant_id","system_id","code");
CREATE INDEX "module_masters_system_id_idx" ON "module_masters"("system_id");

-- ── 6. Rename tables: sap_sub_module_masters → sub_module_masters ──────────
ALTER TABLE "sap_sub_module_masters" RENAME TO "sub_module_masters";
ALTER INDEX "sap_sub_module_masters_pkey"                       RENAME TO "sub_module_masters_pkey";
ALTER INDEX "sap_sub_module_masters_tenant_id_module_id_idx"    RENAME TO "sub_module_masters_tenant_id_module_id_idx";
ALTER INDEX "sap_sub_module_masters_tenant_id_module_id_code_key" RENAME TO "sub_module_masters_tenant_id_module_id_code_key";

ALTER TABLE "sub_module_masters" ADD COLUMN "system_id" TEXT;
UPDATE "sub_module_masters" SET "system_id" = '11111111-1111-4111-8111-000000000001';
ALTER TABLE "sub_module_masters" ALTER COLUMN "system_id" SET NOT NULL;

CREATE INDEX "sub_module_masters_system_id_idx" ON "sub_module_masters"("system_id");

-- ── 7. Rename columns: agent_specializations ───────────────────────────────
ALTER TABLE "agent_specializations" RENAME COLUMN "sap_module_id"      TO "module_id";
ALTER TABLE "agent_specializations" RENAME COLUMN "sap_sub_module_ids" TO "sub_module_ids";
CREATE UNIQUE INDEX "agent_specializations_agent_id_module_id_key"
    ON "agent_specializations"("agent_id","module_id");

-- ── 8. Rename columns: assignment_rules ────────────────────────────────────
ALTER TABLE "assignment_rules" RENAME COLUMN "sap_module_id" TO "module_id";

-- ── 9. Rename columns: itsm_records + add system_id ────────────────────────
ALTER TABLE "itsm_records" RENAME COLUMN "sap_module_id"     TO "module_id";
ALTER TABLE "itsm_records" RENAME COLUMN "sap_sub_module_id" TO "sub_module_id";
ALTER TABLE "itsm_records" ADD COLUMN "system_id" TEXT;
UPDATE "itsm_records" SET "system_id" = '11111111-1111-4111-8111-000000000001';
-- itsm_records.system_id stays nullable per schema (can be set NULL on system delete)
CREATE INDEX "itsm_records_system_id_idx" ON "itsm_records"("system_id");

-- ── 10. Rename column: issue_templates.enterprise_system_id → system_id ────
ALTER TABLE "issue_templates" RENAME COLUMN "enterprise_system_id" TO "system_id";
-- Backfill any NULL system_id to SAP (existing 27 templates were never set)
UPDATE "issue_templates" SET "system_id" = '11111111-1111-4111-8111-000000000001'
    WHERE "system_id" IS NULL;
CREATE INDEX "issue_templates_system_id_idx" ON "issue_templates"("system_id");

-- ── 11. Backfill customer_systems for existing customers ───────────────────
INSERT INTO "customer_systems" ("customer_id", "system_id")
SELECT "id", '11111111-1111-4111-8111-000000000001'
FROM "customers";

-- ── 12. Re-add FK constraints with new names ───────────────────────────────
ALTER TABLE "module_masters"
    ADD CONSTRAINT "module_masters_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_masters"
    ADD CONSTRAINT "module_masters_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sub_module_masters"
    ADD CONSTRAINT "sub_module_masters_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_module_masters"
    ADD CONSTRAINT "sub_module_masters_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_module_masters"
    ADD CONSTRAINT "sub_module_masters_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "module_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_specializations"
    ADD CONSTRAINT "agent_specializations_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "module_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assignment_rules"
    ADD CONSTRAINT "assignment_rules_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "module_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "itsm_records"
    ADD CONSTRAINT "itsm_records_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "module_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itsm_records"
    ADD CONSTRAINT "itsm_records_sub_module_id_fkey"
    FOREIGN KEY ("sub_module_id") REFERENCES "sub_module_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "itsm_records"
    ADD CONSTRAINT "itsm_records_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_templates"
    ADD CONSTRAINT "issue_templates_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_systems"
    ADD CONSTRAINT "customer_systems_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_systems"
    ADD CONSTRAINT "customer_systems_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "classifier_configs"
    ADD CONSTRAINT "classifier_configs_system_id_fkey"
    FOREIGN KEY ("system_id") REFERENCES "enterprise_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
