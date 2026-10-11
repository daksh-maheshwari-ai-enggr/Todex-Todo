import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStoredToken, setStoredToken } from "../services/api.js";
import * as authService from "../services/authService.js";

// Holds the JWT (in localStorage) and the current user. The token is the only
// thing persisted client-side; provider API keys and database credentials never
// reach the browser.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // "loading" while a stored token is being validated, then authenticated or
  // anonymous. Guards wait for this so a page refresh never flashes the login
  // screen for an already signed-in user.
  const [status, setStatus] = useState(() => (getStoredToken() ? "loading" : "anonymous"));

  useEffect(() => {
    if (!getStoredToken()) {
      setStatus("anonymous");
      return undefined;
    }

    let active = true;

    (async () => {
      try {
        const currentUser = await authService.fetchCurrentUser();
        if (!active) return;
        setUser(currentUser);
        setStatus("authenticated");
      } catch {
        // Expired or invalid token: drop it and fall back to the login screen.
        if (!active) return;
        setStoredToken(null);
        setUser(null);
        setStatus("anonymous");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const { user: nextUser } = await authService.login({ email, password });
    setUser(nextUser);
    setStatus("authenticated");
    return nextUser;
  }, []);

  const signUp = useCallback(async ({ name, email, password }) => {
    const { user: nextUser } = await authService.register({ name, email, password });
    setUser(nextUser);
    setStatus("authenticated");
    return nextUser;
  }, []);

  const signOut = useCallback(() => {
    authService.logout();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      signIn,
      signUp,
      signOut,
    }),
    [user, status, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }
  return value;
}
