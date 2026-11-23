ALTER TABLE "MedicalKnowledgeSource"
  ADD COLUMN "embeddingModel" VARCHAR(80) NOT NULL DEFAULT 'text-embedding-3-small';
