import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import { router } from "./app/router.jsx";

// AuthProvider wraps the router so every route element (and guard) can read the
// authenticated user and token from context.
export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
