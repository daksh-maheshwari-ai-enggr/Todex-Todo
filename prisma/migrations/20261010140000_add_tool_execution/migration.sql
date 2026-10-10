-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" VARCHAR(100) NOT NULL,
    "toolCallId" VARCHAR(200),
    "args" VARCHAR(4000),
    "status" "ToolExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "result" VARCHAR(4000),
    "error" VARCHAR(2000),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolExecution_chatId_idx" ON "ToolExecution"("chatId");
CREATE INDEX "ToolExecution_userId_idx" ON "ToolExecution"("userId");
CREATE UNIQUE INDEX "ToolExecution_chatId_toolCallId_key" ON "ToolExecution"("chatId", "toolCallId");

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
