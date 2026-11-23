ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_PROFILE_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_PROFILE_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_HEALTH_INFORMATION_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_HEALTH_INFORMATION_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_PROFILE_VIEWED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_HEALTH_INFORMATION_VIEWED';

CREATE TYPE "PatientGender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');
CREATE TYPE "BloodGroup" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN');
CREATE TYPE "DiabetesStatus" AS ENUM ('UNKNOWN', 'YES', 'NO', 'PREDIABETES');
CREATE TYPE "HypertensionStatus" AS ENUM ('UNKNOWN', 'YES', 'NO');

CREATE TABLE "PatientProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" VARCHAR(120),
    "dateOfBirth" DATE,
    "gender" "PatientGender",
    "bloodGroup" "BloodGroup",
    "profilePhotoKey" VARCHAR(512),
    "addressLine1" VARCHAR(200),
    "addressLine2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postalCode" VARCHAR(6),
    "country" VARCHAR(100) NOT NULL DEFAULT 'India',
    "emergencyContactName" VARCHAR(120),
    "emergencyContactPhone" VARCHAR(16),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientHealthInformation" (
    "id" UUID NOT NULL,
    "patientProfileId" UUID NOT NULL,
    "diabetesStatus" "DiabetesStatus" NOT NULL DEFAULT 'UNKNOWN',
    "hypertensionStatus" "HypertensionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "allergies" TEXT,
    "existingMedicalConditions" TEXT,
    "currentMedications" TEXT,
    "additionalNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PatientHealthInformation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientProfile_userId_key" ON "PatientProfile"("userId");
CREATE INDEX "PatientProfile_updatedAt_idx" ON "PatientProfile"("updatedAt");
CREATE UNIQUE INDEX "PatientHealthInformation_patientProfileId_key" ON "PatientHealthInformation"("patientProfileId");
CREATE INDEX "PatientHealthInformation_updatedAt_idx" ON "PatientHealthInformation"("updatedAt");

ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientHealthInformation" ADD CONSTRAINT "PatientHealthInformation_patientProfileId_fkey"
  FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
