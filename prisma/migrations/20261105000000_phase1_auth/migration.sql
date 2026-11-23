CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "DoctorVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER', 'LOGIN', 'RECOVERY');
CREATE TYPE "AuthEventType" AS ENUM (
  'OTP_REQUESTED', 'OTP_DELIVERY_FAILED', 'OTP_VERIFICATION_FAILED', 'OTP_VERIFIED',
  'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'SESSION_REFRESHED', 'SESSION_REUSE_DETECTED',
  'SESSION_REVOKED', 'ALL_SESSIONS_REVOKED', 'REGISTRATION_SUCCEEDED', 'REGISTRATION_FAILED'
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "phoneNumber" VARCHAR(16) NOT NULL,
  "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
  "role" "UserRole" NOT NULL DEFAULT 'PATIENT',
  "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "doctorVerificationStatus" "DoctorVerificationStatus",
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "lastLoginAt" TIMESTAMPTZ(6),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
CREATE INDEX "User_role_accountStatus_idx" ON "User"("role", "accountStatus");

CREATE TABLE "OtpChallenge" (
  "id" UUID NOT NULL,
  "phoneNumber" VARCHAR(16) NOT NULL,
  "otpHash" CHAR(64) NOT NULL,
  "purpose" "OtpPurpose" NOT NULL,
  "requestedRole" "UserRole",
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OtpChallenge_phoneNumber_purpose_createdAt_idx" ON "OtpChallenge"("phoneNumber", "purpose", "createdAt");
CREATE INDEX "OtpChallenge_expiresAt_consumedAt_idx" ON "OtpChallenge"("expiresAt", "consumedAt");

CREATE TABLE "RefreshSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "deviceId" VARCHAR(128),
  "deviceName" VARCHAR(128),
  "platform" VARCHAR(16),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");
CREATE INDEX "RefreshSession_userId_revokedAt_expiresAt_idx" ON "RefreshSession"("userId", "revokedAt", "expiresAt");

CREATE TABLE "AuthAuditLog" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "eventType" "AuthEventType" NOT NULL,
  "ipAddress" VARCHAR(64),
  "deviceInformation" VARCHAR(256),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuthAuditLog_userId_createdAt_idx" ON "AuthAuditLog"("userId", "createdAt");
CREATE INDEX "AuthAuditLog_eventType_createdAt_idx" ON "AuthAuditLog"("eventType", "createdAt");
