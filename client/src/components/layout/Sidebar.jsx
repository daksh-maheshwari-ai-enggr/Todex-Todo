import { NavLink } from "react-router-dom";
import {
  Briefcase,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { initials } from "../../utils/format.js";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/teammates", label: "AI Teammates", icon: Users },
  { to: "/chat", label: "Chat Workspace", icon: MessageSquare },
  { to: "/group-chats", label: "Group Chats", icon: UsersRound },
  { to: "/jobs", label: "Background Jobs", icon: Briefcase },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Sidebar() {
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-sidebar lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-white">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">Todex</p>
          <p className="text-[11px] text-ink-muted">AI Teammates</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 scrollbar-slim">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-card text-primary-strong shadow-[0_1px_2px_rgba(38,36,58,0.05)]"
                  : "text-ink-muted hover:bg-card/70 hover:text-ink",
              ].join(" ")
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-strong">
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-ink">{user?.name ?? "Signed in"}</p>
            <p className="truncate text-[11px] text-ink-muted">{user?.email ?? ""}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            title="Log out"
            aria-label="Log out"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-ink"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
