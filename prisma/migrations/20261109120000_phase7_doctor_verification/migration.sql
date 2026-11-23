ALTER TYPE "DoctorVerificationStatus" RENAME VALUE 'VERIFIED' TO 'APPROVED';
ALTER TYPE "DoctorVerificationStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "DoctorVerificationStatus" ADD VALUE 'SUSPENDED';

-- Legacy synthetic demo doctor accounts are never considered approved applications.
UPDATE "User" SET "doctorVerificationStatus" = 'PENDING'
WHERE "role" = 'DOCTOR' AND "isDevelopmentTestAccount" = TRUE;

ALTER TABLE "DoctorProfile"
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "qualification" VARCHAR(160),
  ADD COLUMN "specialization" VARCHAR(160),
  ADD COLUMN "clinicName" VARCHAR(180),
  ADD COLUMN "clinicAddress" VARCHAR(500);

CREATE TABLE "DoctorVerificationDocument" (
  "id" UUID NOT NULL,
  "doctorProfileId" UUID NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "storageKey" VARCHAR(64) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileChecksum" CHAR(64) NOT NULL,
  "scanStatus" "MedicalDocumentScanStatus" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorVerificationDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorVerificationDocument_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DoctorVerificationDocument_storageKey_key" ON "DoctorVerificationDocument"("storageKey");
CREATE INDEX "DoctorVerificationDocument_doctorProfileId_createdAt_idx" ON "DoctorVerificationDocument"("doctorProfileId", "createdAt" DESC);

CREATE TABLE "DoctorVerificationAudit" (
  "id" UUID NOT NULL,
  "doctorProfileId" UUID NOT NULL,
  "reviewerUserId" UUID NOT NULL,
  "fromStatus" "DoctorVerificationStatus" NOT NULL,
  "toStatus" "DoctorVerificationStatus" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorVerificationAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorVerificationAudit_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DoctorVerificationAudit_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DoctorVerificationAudit_doctorProfileId_createdAt_idx" ON "DoctorVerificationAudit"("doctorProfileId", "createdAt" DESC);
CREATE INDEX "DoctorVerificationAudit_reviewerUserId_createdAt_idx" ON "DoctorVerificationAudit"("reviewerUserId", "createdAt" DESC);

