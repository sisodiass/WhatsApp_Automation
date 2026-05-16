// M11.C1 — consume a reset-password token from ?token= and set a new
// password. Backend enforces 8+ char minimum; we mirror that here for
// instant feedback before submit.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, KeyRound } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) setError("Reset link is missing its token. Request a new email.");
  }, [token]);

  const passwordOk = password.length >= 8;
  const matches = password === confirm;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!passwordOk) return setError("Password must be at least 8 characters.");
    if (!matches) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      // Redirect to login after a short pause so the success state is visible.
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (err) {
      setError(err.response?.data?.error?.message || "Couldn't reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            SA
          </div>
          <span className="text-sm font-semibold tracking-tight">SalesAutomation</span>
        </div>

        <Card>
          <CardContent className="p-6">
            {done ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="h-5 w-5" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">Password updated</h1>
                <p className="text-xs text-muted-foreground">
                  Redirecting you to sign in…
                </p>
              </div>
            ) : (
              <>
                <h1 className="text-lg font-semibold tracking-tight">Set a new password</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Minimum 8 characters.
                </p>

                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-foreground">New password</span>
                    <Input
                      type="password"
                      required
                      autoFocus
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-foreground">Confirm</span>
                    <Input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>

                  {error && (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={busy || !token || !passwordOk || !matches}
                    size="lg"
                    className="w-full"
                  >
                    <KeyRound className="h-4 w-4" />
                    {busy ? "Updating…" : "Update password"}
                  </Button>

                  <div className="pt-1 text-center">
                    <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground">
                      Back to sign in
                    </Link>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
