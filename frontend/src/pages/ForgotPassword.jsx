// M11.C1 — request a password-reset email. The backend always returns
// 200 (account enumeration protection), so we show the same success
// screen regardless of whether the email is registered.

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      // The backend should always 200 — only validation errors land here.
      setError(err.response?.data?.error?.message || "Couldn't submit request");
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
            {sent ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                  <MailCheck className="h-5 w-5" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">Check your inbox</h1>
                <p className="text-xs text-muted-foreground">
                  If an account exists for <strong>{email}</strong>, we've sent a reset link.
                  The link expires in 1 hour.
                </p>
                <Link
                  to="/login"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <h1 className="text-lg font-semibold tracking-tight">Reset password</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter the email on your account. We'll send a reset link if it's registered.
                </p>

                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-foreground">Email</span>
                    <Input
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>

                  {error && (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </div>
                  )}

                  <Button type="submit" disabled={busy || !email} size="lg" className="w-full">
                    <KeyRound className="h-4 w-4" />
                    {busy ? "Sending…" : "Send reset link"}
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
