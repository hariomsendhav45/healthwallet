ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_UPLOAD_INITIATED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_UPLOAD_COMPLETED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_UPLOAD_REJECTED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_VIEWED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_METADATA_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_DELETED';
ALTER TYPE "AuthEventType" ADD VALUE 'MEDICAL_DOCUMENT_UNAUTHORIZED_ACCESS';

CREATE TYPE "MedicalDocumentCategory" AS ENUM (
  'BLOOD_TEST', 'URINE_TEST', 'RADIOLOGY', 'X_RAY', 'MRI', 'CT_SCAN',
  'ULTRASOUND', 'PRESCRIPTION', 'DISCHARGE_SUMMARY', 'CONSULTATION_REPORT', 'ECG', 'OTHER'
);
CREATE TYPE "MedicalDocumentStatus" AS ENUM ('AVAILABLE', 'DELETING', 'DELETED', 'FAILED', 'REJECTED');
CREATE TYPE "MedicalDocumentScanStatus" AS ENUM ('CLEAN', 'NOT_SCANNED');

CREATE TABLE "MedicalDocument" (
  "id" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "uploadedByUserId" UUID NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" VARCHAR(2000),
  "category" "MedicalDocumentCategory" NOT NULL,
  "documentDate" DATE,
  "originalFileName" VARCHAR(255) NOT NULL,
  "storageKey" VARCHAR(512) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileChecksum" CHAR(64) NOT NULL,
  "uploadStatus" "MedicalDocumentStatus" NOT NULL DEFAULT 'AVAILABLE',
  "scanStatus" "MedicalDocumentScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "deletedAt" TIMESTAMPTZ(6),
  CONSTRAINT "MedicalDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicalDocument_fileSize_check" CHECK ("fileSize" > 0)
);
CREATE UNIQUE INDEX "MedicalDocument_storageKey_key" ON "MedicalDocument"("storageKey");
CREATE INDEX "MedicalDocument_patientProfileId_deletedAt_createdAt_idx" ON "MedicalDocument"("patientProfileId", "deletedAt", "createdAt");
CREATE INDEX "MedicalDocument_patientProfileId_category_documentDate_idx" ON "MedicalDocument"("patientProfileId", "category", "documentDate");
CREATE INDEX "MedicalDocument_uploadedByUserId_createdAt_idx" ON "MedicalDocument"("uploadedByUserId", "createdAt");
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_patientProfileId_fkey"
  FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
