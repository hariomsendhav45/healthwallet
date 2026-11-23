CREATE TYPE "PatientReminderType" AS ENUM ('APPOINTMENT', 'PATIENT_FOLLOW_UP', 'REPORT_REVIEW', 'MEASUREMENT');
CREATE TYPE "AiFeedbackRating" AS ENUM ('HELPFUL', 'NOT_HELPFUL');
CREATE TYPE "AiFeedbackCategory" AS ENUM ('INCORRECT_INFORMATION', 'MISSING_CONTEXT', 'REPORT_INTERPRETATION', 'LANGUAGE_QUALITY', 'OTHER');

CREATE TABLE "PatientReminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "type" "PatientReminderType" NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "disabledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PatientReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiResponseFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "rating" "AiFeedbackRating" NOT NULL,
    "category" "AiFeedbackCategory",
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiResponseFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientReminder_userId_disabledAt_completedAt_dueAt_idx" ON "PatientReminder"("userId", "disabledAt", "completedAt", "dueAt");
CREATE UNIQUE INDEX "AiResponseFeedback_userId_responseId_key" ON "AiResponseFeedback"("userId", "responseId");
CREATE INDEX "AiResponseFeedback_userId_createdAt_idx" ON "AiResponseFeedback"("userId", "createdAt" DESC);

ALTER TABLE "PatientReminder" ADD CONSTRAINT "PatientReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiResponseFeedback" ADD CONSTRAINT "AiResponseFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
