-- CreateEnum
CREATE TYPE "MedicalShareStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MedicalSharePermissionType" AS ENUM ('PROFILE_BASIC', 'BLOOD_GROUP', 'HEALTH_INFORMATION', 'MEDICAL_DOCUMENTS', 'BLOOD_PRESSURE_READINGS', 'BLOOD_GLUCOSE_READINGS');

-- CreateEnum
CREATE TYPE "DoctorAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MedicalRecordAccessGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MedicalSharingEventType" AS ENUM ('SHARE_SESSION_CREATED', 'SHARE_SESSION_REVOKED', 'SHARE_TOKEN_VALIDATED', 'DOCTOR_ACCESS_REQUESTED', 'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'SHARED_RECORDS_VIEWED', 'SHARED_DOCUMENT_DOWNLOADED', 'ACCESS_GRANT_REVOKED', 'ACCESS_GRANT_EXPIRED', 'UNAUTHORIZED_ACCESS_ATTEMPTED');

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" VARCHAR(120),
    "professionalRegistrationNo" VARCHAR(120),
    "registrationAuthority" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalShareSession" (
    "id" UUID NOT NULL,
    "patientProfileId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "MedicalShareStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 5,
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MedicalShareSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MedicalShareSession"
  ADD CONSTRAINT "MedicalShareSession_use_count_check" CHECK ("useCount" >= 0 AND "maxUses" BETWEEN 1 AND 5 AND "useCount" <= "maxUses");

-- CreateTable
CREATE TABLE "MedicalSharePermission" (
    "id" UUID NOT NULL,
    "shareSessionId" UUID NOT NULL,
    "permissionType" "MedicalSharePermissionType" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalSharePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalShareDocument" (
    "id" UUID NOT NULL,
    "shareSessionId" UUID NOT NULL,
    "medicalDocumentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalShareDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorAccessRequest" (
    "id" UUID NOT NULL,
    "shareSessionId" UUID NOT NULL,
    "patientProfileId" UUID NOT NULL,
    "doctorUserId" UUID NOT NULL,
    "status" "DoctorAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedByUserId" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DoctorAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecordAccessGrant" (
    "id" UUID NOT NULL,
    "patientProfileId" UUID NOT NULL,
    "doctorUserId" UUID NOT NULL,
    "shareSessionId" UUID NOT NULL,
    "accessRequestId" UUID NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "status" "MedicalRecordAccessGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedByUserId" UUID,

    CONSTRAINT "MedicalRecordAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalSharingAuditLog" (
    "id" UUID NOT NULL,
    "patientProfileId" UUID,
    "doctorUserId" UUID,
    "actorUserId" UUID,
    "shareSessionId" UUID,
    "eventType" "MedicalSharingEventType" NOT NULL,
    "ipAddress" VARCHAR(64),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalSharingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_userId_key" ON "DoctorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalShareSession_tokenHash_key" ON "MedicalShareSession"("tokenHash");

-- CreateIndex
CREATE INDEX "MedicalShareSession_patientProfileId_status_expiresAt_idx" ON "MedicalShareSession"("patientProfileId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "MedicalShareSession_expiresAt_status_idx" ON "MedicalShareSession"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "MedicalSharePermission_permissionType_shareSessionId_idx" ON "MedicalSharePermission"("permissionType", "shareSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalSharePermission_shareSessionId_permissionType_key" ON "MedicalSharePermission"("shareSessionId", "permissionType");

-- CreateIndex
CREATE INDEX "MedicalShareDocument_medicalDocumentId_idx" ON "MedicalShareDocument"("medicalDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalShareDocument_shareSessionId_medicalDocumentId_key" ON "MedicalShareDocument"("shareSessionId", "medicalDocumentId");

-- CreateIndex
CREATE INDEX "DoctorAccessRequest_patientProfileId_status_requestedAt_idx" ON "DoctorAccessRequest"("patientProfileId", "status", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "DoctorAccessRequest_doctorUserId_status_requestedAt_idx" ON "DoctorAccessRequest"("doctorUserId", "status", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "DoctorAccessRequest_expiresAt_status_idx" ON "DoctorAccessRequest"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorAccessRequest_shareSessionId_doctorUserId_key" ON "DoctorAccessRequest"("shareSessionId", "doctorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecordAccessGrant_accessRequestId_key" ON "MedicalRecordAccessGrant"("accessRequestId");

-- CreateIndex
CREATE INDEX "MedicalRecordAccessGrant_patientProfileId_status_expiresAt_idx" ON "MedicalRecordAccessGrant"("patientProfileId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "MedicalRecordAccessGrant_doctorUserId_status_expiresAt_idx" ON "MedicalRecordAccessGrant"("doctorUserId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "MedicalRecordAccessGrant_shareSessionId_status_idx" ON "MedicalRecordAccessGrant"("shareSessionId", "status");

-- CreateIndex
CREATE INDEX "MedicalSharingAuditLog_patientProfileId_createdAt_idx" ON "MedicalSharingAuditLog"("patientProfileId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MedicalSharingAuditLog_doctorUserId_createdAt_idx" ON "MedicalSharingAuditLog"("doctorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MedicalSharingAuditLog_eventType_createdAt_idx" ON "MedicalSharingAuditLog"("eventType", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalShareSession" ADD CONSTRAINT "MedicalShareSession_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalShareSession" ADD CONSTRAINT "MedicalShareSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSharePermission" ADD CONSTRAINT "MedicalSharePermission_shareSessionId_fkey" FOREIGN KEY ("shareSessionId") REFERENCES "MedicalShareSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalShareDocument" ADD CONSTRAINT "MedicalShareDocument_shareSessionId_fkey" FOREIGN KEY ("shareSessionId") REFERENCES "MedicalShareSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalShareDocument" ADD CONSTRAINT "MedicalShareDocument_medicalDocumentId_fkey" FOREIGN KEY ("medicalDocumentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAccessRequest" ADD CONSTRAINT "DoctorAccessRequest_shareSessionId_fkey" FOREIGN KEY ("shareSessionId") REFERENCES "MedicalShareSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAccessRequest" ADD CONSTRAINT "DoctorAccessRequest_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAccessRequest" ADD CONSTRAINT "DoctorAccessRequest_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAccessRequest" ADD CONSTRAINT "DoctorAccessRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_shareSessionId_fkey" FOREIGN KEY ("shareSessionId") REFERENCES "MedicalShareSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_accessRequestId_fkey" FOREIGN KEY ("accessRequestId") REFERENCES "DoctorAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordAccessGrant" ADD CONSTRAINT "MedicalRecordAccessGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSharingAuditLog" ADD CONSTRAINT "MedicalSharingAuditLog_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSharingAuditLog" ADD CONSTRAINT "MedicalSharingAuditLog_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSharingAuditLog" ADD CONSTRAINT "MedicalSharingAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalSharingAuditLog" ADD CONSTRAINT "MedicalSharingAuditLog_shareSessionId_fkey" FOREIGN KEY ("shareSessionId") REFERENCES "MedicalShareSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
