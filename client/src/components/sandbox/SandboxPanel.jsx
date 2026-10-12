import { useState } from "react";
import { Activity, FolderTree, Monitor, Radio, SquareTerminal } from "lucide-react";
import Tabs from "../ui/Tabs.jsx";
import BrowserPane from "./BrowserPane.jsx";
import TerminalPane from "./TerminalPane.jsx";
import FilesPane from "./FilesPane.jsx";
import ActivityFeed from "../activity/ActivityFeed.jsx";
import LiveActivityFeed from "../activity/LiveActivityFeed.jsx";
import { sandboxSummary } from "../../utils/sandboxData.js";

// The right-hand workspace panel: a large sandbox view with tabs. Live events
// stream in while a turn runs; the Activity tab keeps the durable, persisted
// record of tool calls and handoffs.
export default function SandboxPanel({
  teammate,
  executions = [],
  handoffs = [],
  activityLoading = false,
  activityError = null,
  onRefreshActivity,
  liveEvents = [],
  liveConnection = "idle",
  liveError = null,
  liveTaskState = "idle",
  onClearLive,
}) {
  const [tab, setTab] = useState("live");
  const summary = sandboxSummary(executions);

  const tabs = [
    { id: "live", label: "Live", icon: Radio, count: liveEvents.length || null },
    { id: "browser", label: "Browser / Desktop", icon: Monitor },
    { id: "terminal", label: "Terminal", icon: SquareTerminal, count: summary.commands },
    { id: "files", label: "Files", icon: FolderTree, count: summary.files },
    { id: "activity", label: "Activity", icon: Activity, count: summary.total + handoffs.length },
  ];

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5">
        <Tabs tabs={tabs} activeId={tab} onChange={setTab} />
        {summary.failures > 0 && (
          <span className="shrink-0 rounded-full bg-error px-2 py-0.5 text-[10px] font-semibold text-error-ink">
            {summary.failures} failed
          </span>
        )}
      </div>

      {tab === "live" && (
        <LiveActivityFeed
          events={liveEvents}
          connection={liveConnection}
          error={liveError}
          taskState={liveTaskState}
          onClear={onClearLive}
        />
      )}
      {tab === "browser" && <BrowserPane teammate={teammate} />}
      {tab === "terminal" && (
        <TerminalPane executions={executions} loading={activityLoading} />
      )}
      {tab === "files" && <FilesPane executions={executions} loading={activityLoading} />}
      {tab === "activity" && (
        <ActivityFeed
          executions={executions}
          handoffs={handoffs}
          loading={activityLoading}
          error={activityError}
          onRefresh={onRefreshActivity}
          emptyTitle="No teammate activity yet"
          emptyDescription="Tool calls and teammate handoffs for this chat will appear here."
          emptyNote="Sourced from GET /api/tool-executions/:chatId and GET /api/handoffs/:chatId."
        />
      )}
    </section>
  );
}
