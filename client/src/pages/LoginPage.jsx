import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import Input from "../components/ui/Input.jsx";

export default function LoginPage() {
  const { isAuthenticated, status, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from || "/"} replace />;
  }

  const isRegister = mode === "register";

  function update(field) {
    return (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isRegister) {
        await signUp({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        });
      } else {
        await signIn({ email: form.email.trim(), password: form.password });
      }
      navigate(location.state?.from || "/", { replace: true });
    } catch (submitError) {
      setError(submitError?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-app px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-white">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-lg font-semibold text-ink">Todex</h1>
          <p className="mt-1 text-xs text-ink-muted">
            AI teammates with shared memory, sandboxes and durable background jobs.
          </p>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="space-y-4">
            {isRegister && (
              <Input
                label="Name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                value={form.name}
                onChange={update("name")}
                placeholder="Ada Lovelace"
              />
            )}

            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={form.email}
              onChange={update("email")}
              placeholder="you@example.com"
            />

            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={6}
              maxLength={128}
              value={form.password}
              onChange={update("password")}
              placeholder="At least 6 characters"
              hint={isRegister ? "6–128 characters." : undefined}
            />

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" loading={submitting} className="w-full" size="lg">
              {isRegister ? "Create account" : "Log in"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-ink-muted">
            {isRegister ? "Already have an account?" : "Need an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(isRegister ? "login" : "register");
                setError(null);
              }}
              className="font-medium text-primary-strong hover:underline"
            >
              {isRegister ? "Log in" : "Create one"}
            </button>
          </p>
        </Card>

        <p className="mt-4 text-center text-[11px] text-ink-muted">
          Authentication uses the existing JWT endpoints.
          {status === "loading" ? " Checking your session…" : ""}
        </p>
      </div>
    </div>
  );
}
