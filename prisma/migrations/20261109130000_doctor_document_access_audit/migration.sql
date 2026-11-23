CREATE TABLE "DoctorVerificationDocumentAccessLog" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "accessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoctorVerificationDocumentAccessLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorVerificationDocumentAccessLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DoctorVerificationDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DoctorVerificationDocumentAccessLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DoctorVerificationDocumentAccessLog_documentId_accessedAt_idx" ON "DoctorVerificationDocumentAccessLog"("documentId", "accessedAt" DESC);
CREATE INDEX "DoctorVerificationDocumentAccessLog_actorUserId_accessedAt_idx" ON "DoctorVerificationDocumentAccessLog"("actorUserId", "accessedAt" DESC);
