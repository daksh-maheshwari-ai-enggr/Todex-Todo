import { Outlet } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar.jsx";

// Sidebar + routed content. `min-h-0` on the content column is what lets the
// chat workspace size its three panels to the viewport instead of the page.
export default function AppLayout() {
  return (
    <div className="flex h-full overflow-hidden bg-app">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
