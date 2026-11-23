ALTER TABLE "MedicalDocumentOcrResult"
  ADD COLUMN "extractedMetadata" JSONB,
  ADD COLUMN "reviewedMetadata" JSONB;
