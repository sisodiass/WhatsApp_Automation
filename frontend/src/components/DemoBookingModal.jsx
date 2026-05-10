import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { api } from "../lib/api.js";
import { Card } from "./ui/Card.jsx";
import { Input } from "./ui/Input.jsx";
import { Button } from "./ui/Button.jsx";

function defaultStartIso() {
  // 1 hour from now, rounded to next 15 minutes.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DemoBookingModal({ chatId, onClose, onBooked }) {
  const [scheduledAt, setScheduledAt] = useState(defaultStartIso());
  const [duration, setDuration] = useState(30);
  const [subject, setSubject] = useState("Product demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [teamsConfigured, setTeamsConfigured] = useState(null);

  useEffect(() => {
    api
      .get("/teams/status")
      .then(({ data }) => setTeamsConfigured(data.configured))
      .catch(() => setTeamsConfigured(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/chats/${chatId}/demo`, {
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number(duration),
        subject,
      });
      onBooked?.(data);
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.error?.message || "Booking failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md animate-slide-up"
      >
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold tracking-tight">Book demo</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Creates a Teams meeting and sends the customer the join link via the
              DEMO_CONFIRMATION template.
            </p>

            {teamsConfigured === false && (
              <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                Microsoft Teams credentials are not configured. The booking will be
                recorded but the customer will receive a placeholder link until you
                fill the{" "}
                <code className="rounded bg-muted px-1 font-mono">microsoft.*</code>{" "}
                settings.
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Field label="When">
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                />
              </Field>
              <Field label="Duration (minutes)">
                <Input
                  type="number"
                  min="5"
                  max="240"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
              </Field>
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            </div>

            {error && (
              <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Booking…" : "Book demo"}
              </Button>
            </div>
          </div>
        </Card>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}
