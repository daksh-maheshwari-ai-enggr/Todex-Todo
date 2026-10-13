-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('QUESTION', 'ACTION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AiJobStatus" ADD VALUE 'WAITING_FOR_USER';

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "lastApprovalId" VARCHAR(200),
ADD COLUMN     "stepCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "botId" TEXT,
    "aiJobId" TEXT,
    "kind" "ApprovalKind" NOT NULL,
    "question" VARCHAR(2000) NOT NULL,
    "options" VARCHAR(2000),
    "toolName" VARCHAR(100),
    "toolCallId" VARCHAR(200),
    "args" VARCHAR(4000),
    "assistantMessageId" VARCHAR(200),
    "responseMessageId" VARCHAR(200),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "response" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_userId_status_idx" ON "ApprovalRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_chatId_status_idx" ON "ApprovalRequest"("chatId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_aiJobId_idx" ON "ApprovalRequest"("aiJobId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AiJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

