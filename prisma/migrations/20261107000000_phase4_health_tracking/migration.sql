ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_BP_READING_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_BP_READING_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_BP_READING_DELETED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_GLUCOSE_READING_CREATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_GLUCOSE_READING_UPDATED';
ALTER TYPE "AuthEventType" ADD VALUE 'PATIENT_GLUCOSE_READING_DELETED';

CREATE TYPE "GlucoseUnit" AS ENUM ('MG_DL', 'MMOL_L');
CREATE TYPE "GlucoseMeasurementType" AS ENUM ('FASTING', 'POST_MEAL', 'RANDOM', 'BEFORE_MEAL', 'AFTER_MEAL', 'BEDTIME', 'OTHER');

CREATE TABLE "BloodPressureReading" (
  "id" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "systolic" INTEGER NOT NULL,
  "diastolic" INTEGER NOT NULL,
  "heartRate" INTEGER,
  "measuredAt" TIMESTAMPTZ(6) NOT NULL,
  "notes" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "deletedAt" TIMESTAMPTZ(6),
  CONSTRAINT "BloodPressureReading_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BloodPressureReading_systolic_check" CHECK ("systolic" > 0),
  CONSTRAINT "BloodPressureReading_diastolic_check" CHECK ("diastolic" > 0 AND "diastolic" < "systolic"),
  CONSTRAINT "BloodPressureReading_heartRate_check" CHECK ("heartRate" IS NULL OR "heartRate" > 0),
  CONSTRAINT "BloodPressureReading_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BloodPressureReading_patientProfileId_deletedAt_measuredAt_idx" ON "BloodPressureReading"("patientProfileId", "deletedAt", "measuredAt" DESC);

CREATE TABLE "BloodGlucoseReading" (
  "id" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "glucoseValue" DECIMAL(7,2) NOT NULL,
  "glucoseUnit" "GlucoseUnit" NOT NULL,
  "measurementType" "GlucoseMeasurementType" NOT NULL,
  "measuredAt" TIMESTAMPTZ(6) NOT NULL,
  "notes" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "deletedAt" TIMESTAMPTZ(6),
  CONSTRAINT "BloodGlucoseReading_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BloodGlucoseReading_value_check" CHECK ("glucoseValue" > 0 AND "glucoseValue" <= 2000),
  CONSTRAINT "BloodGlucoseReading_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BloodGlucoseReading_patientProfileId_deletedAt_measuredAt_idx" ON "BloodGlucoseReading"("patientProfileId", "deletedAt", "measuredAt" DESC);
CREATE INDEX "BloodGlucoseReading_patientProfileId_glucoseUnit_measurementType_measuredAt_idx" ON "BloodGlucoseReading"("patientProfileId", "glucoseUnit", "measurementType", "measuredAt" DESC);
