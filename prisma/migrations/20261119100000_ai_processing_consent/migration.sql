CREATE TABLE "AiProcessingConsent" (
  "userId" UUID NOT NULL,
  "grantedAt" TIMESTAMPTZ(6),
  "withdrawnAt" TIMESTAMPTZ(6),
  "policyVersion" VARCHAR(32) NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProcessingConsent_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "AiProcessingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AiProcessingConsent_grantedAt_withdrawnAt_idx" ON "AiProcessingConsent"("grantedAt", "withdrawnAt");
