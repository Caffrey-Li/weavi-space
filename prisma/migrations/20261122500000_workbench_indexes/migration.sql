-- 11-22 工作台重做：「待我处理」和各角色区块按人查需求 / Bug，补索引（只加索引，不动数据）
CREATE INDEX "requirements_creatorId_idx" ON "requirements"("creatorId");
CREATE INDEX "requirements_proposerId_idx" ON "requirements"("proposerId");
CREATE INDEX "bugs_assigneeId_idx" ON "bugs"("assigneeId");
CREATE INDEX "bugs_frontendId_idx" ON "bugs"("frontendId");
CREATE INDEX "bugs_backendId_idx" ON "bugs"("backendId");
CREATE INDEX "requirement_assignees_userId_idx" ON "requirement_assignees"("userId");
