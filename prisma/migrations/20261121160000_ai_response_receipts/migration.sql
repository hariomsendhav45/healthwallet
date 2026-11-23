CREATE TABLE "AiResponseReceipt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiResponseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiResponseReceipt_responseId_key" ON "AiResponseReceipt"("responseId");
CREATE UNIQUE INDEX "AiResponseReceipt_userId_responseId_key" ON "AiResponseReceipt"("userId", "responseId");
CREATE INDEX "AiResponseReceipt_expiresAt_idx" ON "AiResponseReceipt"("expiresAt");

ALTER TABLE "AiResponseReceipt" ADD CONSTRAINT "AiResponseReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiResponseFeedback" ADD CONSTRAINT "AiResponseFeedback_userId_responseId_fkey" FOREIGN KEY ("userId", "responseId") REFERENCES "AiResponseReceipt"("userId", "responseId") ON DELETE CASCADE ON UPDATE CASCADE;
