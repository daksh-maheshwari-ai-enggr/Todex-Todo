import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { SpinnerBlock } from "../components/ui/Spinner.jsx";
import AppLayout from "./AppLayout.jsx";
import LoginPage from "../pages/LoginPage.jsx";
import DashboardPage from "../pages/DashboardPage.jsx";
import TeammatesPage from "../pages/TeammatesPage.jsx";
import ChatPage from "../pages/ChatPage.jsx";
import GroupChatsPage from "../pages/GroupChatsPage.jsx";
import BackgroundJobsPage from "../pages/BackgroundJobsPage.jsx";
import SettingsPage from "../pages/SettingsPage.jsx";

// Route guard. Waits for the stored token to be validated before deciding, so a
// page refresh never briefly redirects an authenticated user to the login screen.
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <SpinnerBlock label="Restoring your session…" />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "teammates", element: <TeammatesPage /> },
          // The chat id is optional: the workspace shows a picker until one is chosen.
          { path: "chat/:chatId?", element: <ChatPage /> },
          { path: "group-chats", element: <GroupChatsPage /> },
          { path: "group-chats/:chatId", element: <GroupChatsPage /> },
          { path: "jobs", element: <BackgroundJobsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
