ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'MEDICAL_KNOWLEDGE_SOURCE_INGESTED';

CREATE TABLE "MedicalKnowledgeSource" (
  "id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "sourceName" VARCHAR(160) NOT NULL,
  "sourceUrl" VARCHAR(1000) NOT NULL,
  "license" VARCHAR(500) NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "importedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicalKnowledgeSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicalKnowledgeSource_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MedicalKnowledgeSource_sourceUrl_version_key" ON "MedicalKnowledgeSource"("sourceUrl", "version");
CREATE INDEX "MedicalKnowledgeSource_active_sourceName_idx" ON "MedicalKnowledgeSource"("active", "sourceName");

CREATE TABLE "MedicalKnowledgeChunk" (
  "id" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicalKnowledgeChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicalKnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MedicalKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MedicalKnowledgeChunk_sourceId_ordinal_key" ON "MedicalKnowledgeChunk"("sourceId", "ordinal");
CREATE INDEX "MedicalKnowledgeChunk_sourceId_ordinal_idx" ON "MedicalKnowledgeChunk"("sourceId", "ordinal");
