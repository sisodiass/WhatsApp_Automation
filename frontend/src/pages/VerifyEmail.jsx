// M11.C1 — consume an email-verification token from ?token=. Runs
// once on mount; if it succeeds, show the green-check screen and a
// link onward. If it fails (expired / wrong / used), offer to resend.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Loader2, Mail, RefreshCcw } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState(token ? "verifying" : "manual");
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post("/auth/verify-email", { token });
        if (!cancelled) {
          setVerifiedEmail(data.email || null);
          setState("verified");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error?.message || "Verification failed");
          setState("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onResend(e) {
    e.preventDefault();
    if (!email) return;
    setResending(true);
    try {
      await api.post("/auth/resend-verification", { email });
      setResent(true);
    } catch {
      // Same silent-success policy as the backend — show success either way.
      setResent(true);
    } finally {
      setResending(false);
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
            {state === "verifying" && (
              <div className="space-y-3 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Verifying your email…</p>
              </div>
            )}

            {state === "verified" && (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="h-5 w-5" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">Email verified</h1>
                {verifiedEmail && (
                  <p className="text-xs text-muted-foreground">
                    <strong>{verifiedEmail}</strong> is now confirmed.
                  </p>
                )}
                <Link
                  to="/login"
                  className="mt-2 inline-flex text-xs text-muted-foreground hover:text-foreground"
                >
                  Continue to sign in
                </Link>
              </div>
            )}

            {(state === "failed" || state === "manual") && (
              <>
                <h1 className="text-lg font-semibold tracking-tight">
                  {state === "failed" ? "Verification link didn't work" : "Verify your email"}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {state === "failed"
                    ? error || "The link expired or was already used. Request a fresh one."
                    : "Enter your email and we'll send you a fresh verification link."}
                </p>

                {!resent ? (
                  <form onSubmit={onResend} className="mt-5 space-y-3">
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

                    <Button
                      type="submit"
                      disabled={resending || !email}
                      size="lg"
                      className="w-full"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {resending ? "Sending…" : "Send a new link"}
                    </Button>

                    <div className="pt-1 text-center">
                      <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground">
                        Back to sign in
                      </Link>
                    </div>
                  </form>
                ) : (
                  <div className="mt-5 space-y-3 text-center">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success">
                      <Mail className="h-5 w-5" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If an unverified account exists for <strong>{email}</strong>, a fresh
                      verification link is on its way.
                    </p>
                    <Link to="/login" className="inline-flex text-xs text-muted-foreground hover:text-foreground">
                      Back to sign in
                    </Link>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
