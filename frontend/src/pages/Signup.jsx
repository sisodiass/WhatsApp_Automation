// M11.C2 — public signup. Creates a new org (Tenant) + SUPER_ADMIN user.
// On success: stores the access token + user in the auth store and
// redirects to the dashboard. Verification email is sent server-side
// asynchronously; the user doesn't need to verify before signing in
// (matches the rest of the auth UX in this app).
//
// /signup-enabled gates the page: when signup is disabled at the
// platform level we render an "ask your administrator" stub instead
// of the form. Operators flip the gate via Settings → tenant.signup_enabled.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building, Lock, Mail, User as UserIcon, UserPlus } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuthStore } from "../stores/authStore.js";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";

export default function Signup() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [enabled, setEnabled] = useState(null); // null = loading, false = gated, true = open
  const [form, setForm] = useState({
    orgName: "",
    fullName: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/auth/signup-enabled")
      .then(({ data }) => {
        if (!cancelled) setEnabled(Boolean(data?.enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/signup", form);
      setAuth(data.accessToken, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      const code = err.response?.data?.error?.code;
      const msg = err.response?.data?.error?.message;
      if (code === "conflict") {
        setError("An account with this email already exists. Try signing in instead.");
      } else if (code === "forbidden") {
        setError(msg || "Signup is disabled. Contact your administrator.");
      } else {
        setError(msg || "Couldn't create your account");
      }
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
            {enabled === null && (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}

            {enabled === false && (
              <div className="space-y-3 text-center">
                <h1 className="text-lg font-semibold tracking-tight">Signup is closed</h1>
                <p className="text-xs text-muted-foreground">
                  Public sign-ups aren't open on this deployment. If you should
                  have access, ask your administrator to invite you.
                </p>
                <Link
                  to="/login"
                  className="mt-2 inline-flex text-xs text-muted-foreground hover:text-foreground"
                >
                  Back to sign in
                </Link>
              </div>
            )}

            {enabled === true && (
              <>
                <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start a new organization. You'll be its first admin.
                </p>

                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                  <Field icon={Building} label="Organization">
                    <Input
                      type="text"
                      required
                      autoFocus
                      maxLength={120}
                      value={form.orgName}
                      onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))}
                      placeholder="Acme Inc"
                    />
                  </Field>
                  <Field icon={UserIcon} label="Your name">
                    <Input
                      type="text"
                      required
                      maxLength={120}
                      autoComplete="name"
                      value={form.fullName}
                      onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                    />
                  </Field>
                  <Field icon={Mail} label="Work email">
                    <Input
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </Field>
                  <Field icon={Lock} label="Password">
                    <Input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="8+ characters"
                    />
                  </Field>

                  {error && (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={busy} size="lg" className="w-full">
                    <UserPlus className="h-4 w-4" />
                    {busy ? "Creating…" : "Create account"}
                  </Button>

                  <div className="pt-1 text-center">
                    <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground">
                      Already have an account? Sign in
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

function Field({ icon: Icon, label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
        {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
        {label}
      </span>
      {children}
    </label>
  );
}
