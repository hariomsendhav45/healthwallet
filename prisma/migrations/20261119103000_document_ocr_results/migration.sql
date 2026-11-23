CREATE TYPE "MedicalOcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TABLE "MedicalDocumentOcrResult" (
  "documentId" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "status" "MedicalOcrStatus" NOT NULL DEFAULT 'PENDING',
  "extractedText" TEXT,
  "extractedFields" JSONB,
  "reviewedText" TEXT,
  "reviewedFields" JSONB,
  "reviewedAt" TIMESTAMPTZ(6),
  "reviewedByUserId" UUID,
  "failureCode" VARCHAR(64),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicalDocumentOcrResult_pkey" PRIMARY KEY ("documentId"),
  CONSTRAINT "MedicalDocumentOcrResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MedicalDocumentOcrResult_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MedicalDocumentOcrResult_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MedicalDocumentOcrResult_patientProfileId_status_updatedAt_idx" ON "MedicalDocumentOcrResult"("patientProfileId", "status", "updatedAt");
