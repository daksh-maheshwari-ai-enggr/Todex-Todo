import { AlertCircle, Info, KeyRound, LogOut, Server, ShieldCheck, User } from "lucide-react";
import Topbar from "../components/layout/Topbar.jsx";
import Card, { CardHeader } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateTime, initials } from "../utils/format.js";

// Endpoints this UI actually calls, grouped by area. Kept here as documentation
// so the wiring is obvious without reading the whole client.
const API_SURFACE = [
  { area: "Auth", endpoints: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/auth/me"] },
  { area: "Teammates", endpoints: ["GET/POST /api/bots", "GET/PATCH/DELETE /api/bots/:id"] },
  {
    area: "Chats",
    endpoints: [
      "GET/POST /api/chats",
      "GET/PATCH/DELETE /api/chats/:chatId",
      "GET/POST /api/chats/:chatId/participants",
      "DELETE /api/chats/:chatId/participants/:botId",
    ],
  },
  { area: "Messages", endpoints: ["GET /api/messages/:chatId", "POST /api/messages", "PATCH /api/messages/:chatId/read"] },
  { area: "Agent", endpoints: ["POST /api/agents/:botId/respond"] },
  { area: "Activity", endpoints: ["GET /api/tool-executions/:chatId", "GET /api/handoffs/:chatId"] },
  {
    area: "Jobs",
    endpoints: ["POST /api/jobs", "GET /api/jobs", "GET /api/jobs/:jobId", "POST /api/jobs/:jobId/cancel"],
  },
];

export default function SettingsPage() {
  const { user, signOut } = useAuth();

  return (
    <>
      <Topbar
        title="Settings"
        description="Your account, session and the API this workspace talks to."
        actions={
          <Button variant="secondary" size="sm" icon={LogOut} onClick={signOut}>
            Log out
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
        <div className="mx-auto max-w-3xl space-y-5">
          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                icon={User}
                title="Account"
                description="Read-only. The API exposes no profile update endpoint yet."
              />
            </div>

            <div className="px-5 pt-4 pb-5">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary-strong">
                  {initials(user?.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{user?.name ?? "—"}</p>
                  <p className="truncate text-xs text-ink-muted">{user?.email ?? "—"}</p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <Row label="User id" value={user?.id} mono />
                <Row label="Created" value={formatDateTime(user?.createdAt)} />
                <Row label="Updated" value={formatDateTime(user?.updatedAt)} />
                <Row label="Password" value="Stored as a bcrypt hash (never sent to the browser)" />
              </dl>

              <p className="mt-3 rounded-lg border border-line bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                <span className="font-medium text-ink">Backend requirement:</span> editing your name
                or email would need a <span className="font-mono">PATCH /api/auth/me</span> route and
                a password-change route. Neither exists today, so these fields are informational.
              </p>
            </div>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                icon={ShieldCheck}
                title="Session"
                description="Custom JWT authentication against your Express API."
              />
            </div>

            <div className="space-y-3 px-5 pt-4 pb-5">
              <div className="flex items-start gap-2.5">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-ink-muted">
                  A JWT is issued by <span className="font-mono">POST /api/auth/login</span> and sent
                  as <span className="font-mono">Authorization: Bearer …</span> on every request. It is
                  kept in <span className="font-mono">localStorage</span> under{" "}
                  <span className="font-mono">todex.token</span> and validated on load with{" "}
                  <span className="font-mono">GET /api/auth/me</span>.
                </p>
              </div>

              <div className="flex items-start gap-2.5">
                <Server className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-ink-muted">
                  Only the JWT ever reaches the browser. Database credentials, the OpenRouter key,
                  the Daytona key and the Trigger.dev secret key all stay server-side.
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-line bg-sidebar px-3 py-2.5">
                <Badge tone="idle">7-day expiry</Badge>
                <span className="text-[11px] text-ink-muted">
                  Tokens are stateless; logging out clears the local copy.
                </span>
              </div>

              <Button variant="danger" size="sm" icon={LogOut} onClick={signOut}>
                Log out
              </Button>
            </div>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                icon={Info}
                title="API used by this workspace"
                description="Every request below goes through the Vite /api proxy to Express on port 3000."
              />
            </div>

            <div className="px-5 pt-4 pb-5">
              <div className="space-y-3">
                {API_SURFACE.map((group) => (
                  <div key={group.area}>
                    <p className="text-[11px] font-semibold text-ink">{group.area}</p>
                    <ul className="mt-1 space-y-0.5">
                      {group.endpoints.map((endpoint) => (
                        <li key={endpoint} className="font-mono text-[11px] text-ink-muted">
                          {endpoint}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  There is no streaming endpoint, so replies arrive in one piece. Streaming would
                  need a new SSE route on the server.
                </span>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd
        className={["truncate text-ink", mono ? "font-mono text-[11px]" : ""].join(" ")}
        title={value ?? ""}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
