-- AlterTable: attribute assistant messages to the teammate that produced them
ALTER TABLE "Message" ADD COLUMN "botId" TEXT;

-- CreateIndex
CREATE INDEX "Message_botId_idx" ON "Message"("botId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ChatParticipant" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatParticipant_chatId_idx" ON "ChatParticipant"("chatId");
CREATE INDEX "ChatParticipant_botId_idx" ON "ChatParticipant"("botId");
CREATE UNIQUE INDEX "ChatParticipant_chatId_botId_key" ON "ChatParticipant"("chatId", "botId");

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromBotId" TEXT NOT NULL,
    "toBotId" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "task" VARCHAR(2000) NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "result" VARCHAR(4000),
    "error" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Handoff_chatId_idx" ON "Handoff"("chatId");
CREATE INDEX "Handoff_userId_idx" ON "Handoff"("userId");
CREATE INDEX "Handoff_fromBotId_idx" ON "Handoff"("fromBotId");
CREATE INDEX "Handoff_toBotId_idx" ON "Handoff"("toBotId");

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_fromBotId_fkey" FOREIGN KEY ("fromBotId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_toBotId_fkey" FOREIGN KEY ("toBotId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Handoff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
