CREATE TYPE "FamilyRelationshipType" AS ENUM ('PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'OTHER');
CREATE TYPE "FamilyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "FamilyAccessGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "FamilyGuardianVerificationStatus" AS ENUM ('UNVERIFIED');
CREATE TYPE "FamilyAuditEventType" AS ENUM (
  'FAMILY_MEMBER_CREATED',
  'FAMILY_MEMBER_UPDATED',
  'FAMILY_MEMBER_REMOVED',
  'FAMILY_INVITATION_CREATED',
  'FAMILY_INVITATION_RESENT',
  'FAMILY_INVITATION_REVOKED',
  'FAMILY_INVITATION_ACCEPTED',
  'FAMILY_INVITATION_REJECTED',
  'FAMILY_INVITATION_EXPIRED',
  'FAMILY_ACCESS_GRANTED',
  'FAMILY_ACCESS_REVOKED',
  'FAMILY_RECORDS_VIEWED',
  'FAMILY_DOCUMENT_DOWNLOADED',
  'FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED',
  'FAMILY_GUARDIAN_CLAIM_CREATED'
);

CREATE UNIQUE INDEX "PatientProfile_id_userId_key" ON "PatientProfile"("id", "userId");

CREATE TABLE "FamilyMember" (
  "id" UUID NOT NULL,
  "ownerPatientProfileId" UUID NOT NULL,
  "ownerUserId" UUID NOT NULL,
  "claimedByUserId" UUID,
  "fullName" VARCHAR(120) NOT NULL,
  "dateOfBirth" DATE,
  "relationship" "FamilyRelationshipType" NOT NULL,
  "contactNumber" VARCHAR(16),
  "gender" "PatientGender",
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyMember_fullName_not_empty" CHECK (length(btrim("fullName")) > 0),
  CONSTRAINT "FamilyMember_contactNumber_e164" CHECK ("contactNumber" IS NULL OR "contactNumber" ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX "FamilyMember_ownerPatientProfileId_contactNumber_key" ON "FamilyMember"("ownerPatientProfileId", "contactNumber");
CREATE UNIQUE INDEX "FamilyMember_id_claimedByUserId_key" ON "FamilyMember"("id", "claimedByUserId");
CREATE UNIQUE INDEX "FamilyMember_id_ownerUserId_key" ON "FamilyMember"("id", "ownerUserId");
CREATE INDEX "FamilyMember_ownerPatientProfileId_createdAt_idx" ON "FamilyMember"("ownerPatientProfileId", "createdAt");
CREATE INDEX "FamilyMember_claimedByUserId_idx" ON "FamilyMember"("claimedByUserId");
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_ownerPatientProfileId_ownerUserId_fkey" FOREIGN KEY ("ownerPatientProfileId", "ownerUserId") REFERENCES "PatientProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FamilyInvitation" (
  "id" UUID NOT NULL,
  "familyMemberId" UUID NOT NULL,
  "senderUserId" UUID NOT NULL,
  "acceptedByUserId" UUID,
  "targetPhoneNumber" VARCHAR(16) NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "status" "FamilyInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMPTZ(6),
  "rejectedAt" TIMESTAMPTZ(6),
  CONSTRAINT "FamilyInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyInvitation_targetPhone_e164" CHECK ("targetPhoneNumber" ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT "FamilyInvitation_expiry_after_creation" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "FamilyInvitation_tokenHash_key" ON "FamilyInvitation"("tokenHash");
CREATE INDEX "FamilyInvitation_familyMemberId_status_createdAt_idx" ON "FamilyInvitation"("familyMemberId", "status", "createdAt" DESC);
CREATE INDEX "FamilyInvitation_targetPhoneNumber_status_expiresAt_idx" ON "FamilyInvitation"("targetPhoneNumber", "status", "expiresAt");
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_familyMemberId_senderUserId_fkey" FOREIGN KEY ("familyMemberId", "senderUserId") REFERENCES "FamilyMember"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FamilyAccessGrant" (
  "id" UUID NOT NULL,
  "familyMemberId" UUID NOT NULL,
  "patientProfileId" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "grantedByUserId" UUID NOT NULL,
  "status" "FamilyAccessGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  CONSTRAINT "FamilyAccessGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyAccessGrant_expiry_after_grant" CHECK ("expiresAt" > "grantedAt")
);
CREATE INDEX "FamilyAccessGrant_familyMemberId_status_expiresAt_idx" ON "FamilyAccessGrant"("familyMemberId", "status", "expiresAt");
CREATE INDEX "FamilyAccessGrant_patientProfileId_status_expiresAt_idx" ON "FamilyAccessGrant"("patientProfileId", "status", "expiresAt");
CREATE INDEX "FamilyAccessGrant_recipientUserId_status_expiresAt_idx" ON "FamilyAccessGrant"("recipientUserId", "status", "expiresAt");
ALTER TABLE "FamilyAccessGrant" ADD CONSTRAINT "FamilyAccessGrant_familyMemberId_grantedByUserId_fkey" FOREIGN KEY ("familyMemberId", "grantedByUserId") REFERENCES "FamilyMember"("id", "claimedByUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyAccessGrant" ADD CONSTRAINT "FamilyAccessGrant_familyMemberId_recipientUserId_fkey" FOREIGN KEY ("familyMemberId", "recipientUserId") REFERENCES "FamilyMember"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyAccessGrant" ADD CONSTRAINT "FamilyAccessGrant_patientProfileId_grantedByUserId_fkey" FOREIGN KEY ("patientProfileId", "grantedByUserId") REFERENCES "PatientProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyAccessGrant" ADD CONSTRAINT "FamilyAccessGrant_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FamilyAccessPermission" (
  "id" UUID NOT NULL,
  "grantId" UUID NOT NULL,
  "permissionType" "MedicalSharePermissionType" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyAccessPermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyAccessPermission_grantId_permissionType_key" ON "FamilyAccessPermission"("grantId", "permissionType");
CREATE INDEX "FamilyAccessPermission_permissionType_grantId_idx" ON "FamilyAccessPermission"("permissionType", "grantId");
ALTER TABLE "FamilyAccessPermission" ADD CONSTRAINT "FamilyAccessPermission_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "FamilyAccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FamilyAccessDocument" (
  "id" UUID NOT NULL,
  "grantId" UUID NOT NULL,
  "medicalDocumentId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyAccessDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyAccessDocument_grantId_medicalDocumentId_key" ON "FamilyAccessDocument"("grantId", "medicalDocumentId");
CREATE INDEX "FamilyAccessDocument_medicalDocumentId_idx" ON "FamilyAccessDocument"("medicalDocumentId");
ALTER TABLE "FamilyAccessDocument" ADD CONSTRAINT "FamilyAccessDocument_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "FamilyAccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyAccessDocument" ADD CONSTRAINT "FamilyAccessDocument_medicalDocumentId_fkey" FOREIGN KEY ("medicalDocumentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FamilyGuardianRelationship" (
  "id" UUID NOT NULL,
  "familyMemberId" UUID NOT NULL,
  "guardianUserId" UUID NOT NULL,
  "representedPatientProfileId" UUID NOT NULL,
  "verificationStatus" "FamilyGuardianVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyGuardianRelationship_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FamilyGuardianRelationship_familyMemberId_key" ON "FamilyGuardianRelationship"("familyMemberId");
CREATE INDEX "FamilyGuardianRelationship_guardianUserId_verificationStatus_idx" ON "FamilyGuardianRelationship"("guardianUserId", "verificationStatus");
ALTER TABLE "FamilyGuardianRelationship" ADD CONSTRAINT "FamilyGuardianRelationship_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyGuardianRelationship" ADD CONSTRAINT "FamilyGuardianRelationship_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyGuardianRelationship" ADD CONSTRAINT "FamilyGuardianRelationship_representedPatientProfileId_fkey" FOREIGN KEY ("representedPatientProfileId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FamilyAuditLog" (
  "id" UUID NOT NULL,
  "familyMemberId" UUID,
  "actorUserId" UUID,
  "targetUserId" UUID,
  "grantId" UUID,
  "eventType" "FamilyAuditEventType" NOT NULL,
  "ipAddress" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FamilyAuditLog_familyMemberId_createdAt_idx" ON "FamilyAuditLog"("familyMemberId", "createdAt" DESC);
CREATE INDEX "FamilyAuditLog_actorUserId_createdAt_idx" ON "FamilyAuditLog"("actorUserId", "createdAt" DESC);
CREATE INDEX "FamilyAuditLog_targetUserId_createdAt_idx" ON "FamilyAuditLog"("targetUserId", "createdAt" DESC);
CREATE INDEX "FamilyAuditLog_eventType_createdAt_idx" ON "FamilyAuditLog"("eventType", "createdAt" DESC);
ALTER TABLE "FamilyAuditLog" ADD CONSTRAINT "FamilyAuditLog_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FamilyAuditLog" ADD CONSTRAINT "FamilyAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FamilyAuditLog" ADD CONSTRAINT "FamilyAuditLog_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "FamilyAccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
