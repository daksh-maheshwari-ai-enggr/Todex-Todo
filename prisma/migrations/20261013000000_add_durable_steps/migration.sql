-- AlterTable: a TOOL message now records the model tool-call id it answers, so a
-- resumed or retried run can rebuild the assistant tool_call/result pair.
ALTER TABLE "Message" ADD COLUMN "toolCallId" VARCHAR(200);

-- CreateIndex: one tool result per tool call, per chat. Existing USER/ASSISTANT
-- rows all have NULL here and Postgres treats nulls as distinct.
CREATE UNIQUE INDEX "Message_chatId_toolCallId_key" ON "Message"("chatId", "toolCallId");

-- AlterTable: attribute a tool execution to the background job it ran inside.
ALTER TABLE "ToolExecution" ADD COLUMN "aiJobId" TEXT;

-- CreateIndex
CREATE INDEX "ToolExecution_aiJobId_idx" ON "ToolExecution"("aiJobId");

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AiJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
