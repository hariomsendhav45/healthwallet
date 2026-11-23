ALTER TABLE "FamilyAuditLog"
ADD CONSTRAINT "FamilyAuditLog_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
