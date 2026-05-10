import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/authStore.js";
import { useThemeStore } from "../stores/themeStore.js";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import Toaster from "../components/Toaster.jsx";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const hydrate = useThemeStore((s) => s.hydrate);
  const from = location.state?.from?.pathname || "/";

  const [email, setEmail] = useState("admin@local.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuth(data.accessToken, data.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4">
      <Toaster />
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            SA
          </div>
          <span className="text-sm font-semibold tracking-tight">SalesAutomation</span>
        </div>

        <Card>
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-xs text-muted-foreground">Admin console</p>

            <form onSubmit={onSubmit} className="mt-5 space-y-3">
              <Field label="Email">
                <Input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field label="Password">
                <Input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={busy} size="lg" className="w-full">
                <LogIn className="h-4 w-4" />
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
