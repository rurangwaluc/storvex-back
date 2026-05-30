ALTER TABLE "TenantDocumentSettings"
  ADD COLUMN IF NOT EXISTS "documentHeaderDisplay" TEXT NOT NULL DEFAULT 'LOGO_AND_NAME',
  ADD COLUMN IF NOT EXISTS "documentSizeMode" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS "taxMode" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "taxDisplayMode" TEXT NOT NULL DEFAULT 'HIDDEN',
  ADD COLUMN IF NOT EXISTS "taxName" TEXT,
  ADD COLUMN IF NOT EXISTS "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "showTaxOnCustomerDocuments" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TenantDocumentSettings"
  ADD CONSTRAINT "TenantDocumentSettings_documentHeaderDisplay_check"
  CHECK ("documentHeaderDisplay" IN ('LOGO_AND_NAME', 'LOGO_ONLY', 'NAME_ONLY'));

ALTER TABLE "TenantDocumentSettings"
  ADD CONSTRAINT "TenantDocumentSettings_documentSizeMode_check"
  CHECK ("documentSizeMode" IN ('AUTO', 'COMPACT', 'STANDARD'));

ALTER TABLE "TenantDocumentSettings"
  ADD CONSTRAINT "TenantDocumentSettings_taxMode_check"
  CHECK ("taxMode" IN ('NONE', 'VAT_18', 'TURNOVER_3_INTERNAL', 'VAT_18_PLUS_TURNOVER_3', 'CUSTOM'));

ALTER TABLE "TenantDocumentSettings"
  ADD CONSTRAINT "TenantDocumentSettings_taxDisplayMode_check"
  CHECK ("taxDisplayMode" IN ('HIDDEN', 'CUSTOMER_FACING', 'INTERNAL_ONLY'));

ALTER TABLE "TenantDocumentSettings"
  ADD CONSTRAINT "TenantDocumentSettings_taxRateBps_check"
  CHECK ("taxRateBps" >= 0 AND "taxRateBps" <= 10000);