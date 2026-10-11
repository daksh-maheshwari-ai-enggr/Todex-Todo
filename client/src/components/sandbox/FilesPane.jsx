import { useState } from "react";
import { File as FileIcon, FileText, Folder, FolderTree, Upload } from "lucide-react";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";
import CodeBlock from "../ui/CodeBlock.jsx";
import { latestFileContent, latestFileListing, recentWrites } from "../../utils/sandboxData.js";
import { formatBytes, formatRelativeTime } from "../../utils/format.js";

// File explorer + content viewer.
//
// Populated from the file operations the teammate actually performed through the
// sandbox tools: the newest successful listing, the newest readable file and any
// writes. The API has no standalone file route, so the pane can only show what
// was already recorded — it deliberately does not pretend to browse a live
// filesystem.
export default function FilesPane({ executions = [], loading = false }) {
  const [selectedPath, setSelectedPath] = useState(null);

  const listing = latestFileListing(executions);
  const writes = recentWrites(executions);
  const viewed = latestFileContent(executions, selectedPath);

  if (loading && executions.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner label="Loading sandbox files…" />
      </div>
    );
  }

  if (!listing && !viewed && writes.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <EmptyState
          icon={FolderTree}
          title="No sandbox file activity"
          description="Files appear here once a teammate lists, reads or writes something in its sandbox workspace."
          note="Backend requirement: file browse/read routes (for example GET /api/sandbox/:botId/files and /file?path=...) would let this pane navigate the workspace live. Today it can only replay the sandbox_list_files / sandbox_read_file results recorded in tool executions."
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-[11px] text-ink-muted">
        {listing ? (
          <>
            <FolderTree className="size-3.5" aria-hidden="true" />
            <span className="font-mono text-ink">{listing.path}</span>
            <span>· {listing.entries.length} entries</span>
            {listing.truncated && <span className="text-running-ink">· truncated</span>}
            <span>· {formatRelativeTime(listing.recordedAt)}</span>
          </>
        ) : (
          <span>No directory listing recorded yet.</span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-line lg:border-r scrollbar-slim">
          {listing && (
            <ul className="divide-y divide-line-soft">
              {listing.entries.map((entry) => {
                const readable = viewed && viewed.path === entry.path;
                return (
                  <li key={`${entry.path}-${entry.name}`}>
                    <button
                      type="button"
                      onClick={() => !entry.isDir && setSelectedPath(entry.path)}
                      disabled={entry.isDir || !readable}
                      title={
                        entry.isDir
                          ? "Directories cannot be opened: no live browse endpoint exists."
                          : readable
                            ? `View ${entry.path}`
                            : "This file has not been read by the teammate, so its contents are not available."
                      }
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-sidebar disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      {entry.isDir ? (
                        <Folder className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      ) : (
                        <FileIcon className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                      )}
                      <span
                        className={[
                          "min-w-0 flex-1 truncate font-mono",
                          readable ? "text-ink" : "text-ink-muted",
                        ].join(" ")}
                      >
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-muted">
                        {entry.isDir ? "" : formatBytes(entry.size)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {writes.length > 0 && (
            <div className="border-t border-line px-3 py-2">
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                <Upload className="size-3" aria-hidden="true" />
                Written by the teammate
              </p>
              <ul className="space-y-1">
                {writes.slice(0, 8).map((write) => (
                  <li key={write.id} className="truncate font-mono text-[10px] text-ink-muted">
                    {write.path}
                    {write.bytes != null ? ` · ${formatBytes(write.bytes)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-3 scrollbar-slim">
          {viewed ? (
            <div className="flex h-full flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                <FileText className="size-3.5" aria-hidden="true" />
                <span className="font-mono text-ink">{viewed.path}</span>
                {viewed.bytes != null && <span>· {formatBytes(viewed.bytes)}</span>}
                {viewed.truncated && <span className="text-running-ink">· truncated</span>}
                <span>· read {formatRelativeTime(viewed.recordedAt)}</span>
              </div>
              <CodeBlock value={viewed.content} maxHeight="none" className="min-h-0 flex-1" />
            </div>
          ) : (
            <div className="grid h-full place-items-center p-4 text-center">
              <p className="max-w-xs text-xs text-ink-muted">
                Select a file the teammate has read to view its contents. Files that were only
                listed are shown without contents.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
