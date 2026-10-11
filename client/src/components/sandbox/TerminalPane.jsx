import { AlertCircle, CircleCheck, SquareTerminal, Timer } from "lucide-react";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";
import { commandTranscript } from "../../utils/sandboxData.js";
import { formatDuration, formatRelativeTime } from "../../utils/format.js";

// Terminal transcript.
//
// This is a read-only view of commands the teammate actually ran through the
// `sandbox_execute_command` tool inside its isolated Daytona sandbox, as
// persisted by the backend. There is deliberately no command input: the UI must
// not become a shell on the host, and the API exposes no such endpoint.
export default function TerminalPane({ executions = [], loading = false }) {
  const entries = commandTranscript(executions);

  if (loading && executions.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner label="Loading transcripts…" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <EmptyState
          icon={SquareTerminal}
          title="No sandbox commands yet"
          description="Commands appear here after a teammate runs one with the sandbox_execute_command tool."
          note="This pane is read-only on purpose. Commands are executed by the teammate inside its own isolated Daytona sandbox — never on the host — and this view replays the recorded output. There is no shell input endpoint, by design."
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#1d1b2b] px-4 py-3 scrollbar-slim">
      <ol className="space-y-4 font-mono text-[11px] leading-relaxed">
        {entries.map((entry) => {
          const failed = entry.status === "FAILED";
          const nonZero = entry.exitCode != null && entry.exitCode !== 0;

          return (
            <li key={entry.id}>
              <div className="flex flex-wrap items-center gap-2 text-[#9d99b8]">
                <span className="text-[#8978f5]">$</span>
                <span className="text-[#e9e7f5]">{entry.command || "(no command recorded)"}</span>
                {entry.cwd && <span className="opacity-70">in {entry.cwd}</span>}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-[#9d99b8]">
                <span>{formatRelativeTime(entry.completedAt)}</span>
                {entry.durationMs != null && (
                  <span className="inline-flex items-center gap-1">
                    <Timer className="size-3" aria-hidden="true" />
                    {formatDuration(entry.durationMs)}
                  </span>
                )}
                {entry.exitCode != null && (
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                      nonZero ? "bg-[#4a2630] text-[#ffb3bd]" : "bg-[#20382f] text-[#8fe0bd]",
                    ].join(" ")}
                  >
                    {nonZero ? (
                      <AlertCircle className="size-3" aria-hidden="true" />
                    ) : (
                      <CircleCheck className="size-3" aria-hidden="true" />
                    )}
                    exit {entry.exitCode}
                  </span>
                )}
                {failed && (
                  <span className="rounded bg-[#4a2630] px-1.5 py-0.5 text-[#ffb3bd]">
                    execution failed
                  </span>
                )}
                {entry.truncated && (
                  <span className="rounded bg-[#3a3748] px-1.5 py-0.5">output truncated</span>
                )}
              </div>

              {entry.error && (
                <pre className="mt-1.5 overflow-auto rounded border border-[#4a2630] bg-[#2a1d24] px-2 py-1.5 whitespace-pre-wrap text-[#ffb3bd] scrollbar-slim">
                  {entry.error}
                </pre>
              )}

              {entry.output && (
                <pre className="mt-1.5 overflow-auto rounded border border-[#312e42] bg-[#232136] px-2 py-1.5 whitespace-pre-wrap text-[#e9e7f5] scrollbar-slim">
                  {entry.output}
                </pre>
              )}

              {!entry.output && !entry.error && entry.status === "SUCCEEDED" && (
                <p className="mt-1.5 text-[10px] text-[#9d99b8]">(no output)</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
