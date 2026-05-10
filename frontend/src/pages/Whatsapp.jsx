import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { LogOut, MessageCircle, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { confirm } from "../stores/confirmStore.js";
import { getSocket } from "../lib/socket.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge, Dot } from "../components/ui/Badge.jsx";

const STATE_VARIANT = {
  BOOTING: "muted",
  AWAITING_QR: "warning",
  AUTHENTICATING: "info",
  READY: "success",
  DISCONNECTED: "destructive",
  AUTH_FAILURE: "destructive",
};

const STATE_LABEL = {
  BOOTING: "Booting",
  AWAITING_QR: "Awaiting QR scan",
  AUTHENTICATING: "Authenticating",
  READY: "Ready",
  DISCONNECTED: "Disconnected",
  AUTH_FAILURE: "Auth failure",
};

export default function Whatsapp() {
  const [status, setStatus] = useState({ state: "DISCONNECTED" });
  const [worker, setWorker] = useState({ alive: false });
  const [me, setMe] = useState(null);
  const [qrPayload, setQrPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/whatsapp/status").then(({ data }) => {
      if (cancelled) return;
      setStatus(data.status || { state: "DISCONNECTED" });
      setWorker(data.worker || { alive: false });
      setMe(data.me || null);
      if (data.qr) setQrPayload(data.qr);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onQr = (p) => setQrPayload(p);
    const onStatus = (p) => setStatus(p);
    socket.on("wa:qr", onQr);
    socket.on("wa:status", onStatus);
    return () => {
      socket.off("wa:qr", onQr);
      socket.off("wa:status", onStatus);
    };
  }, []);

  useEffect(() => {
    if (!qrPayload?.qr || !canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      qrPayload.qr,
      {
        width: 280,
        margin: 1,
        color: {
          dark: getComputedStyle(document.documentElement)
            .getPropertyValue("--foreground")
            .trim()
            ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim()})`
            : "#000000",
          light: "#00000000",
        },
      },
      (err) => { if (err) console.error("QR render", err); },
    );
  }, [qrPayload, status.state]);

  async function logout() {
    const ok = await confirm({
      title: "Log out the WhatsApp number?",
      description: "The session ends and you'll need to scan a fresh QR to reconnect. Existing chats stay in the database.",
      variant: "destructive",
      confirmLabel: "Log out",
    });
    if (!ok) return;
    setBusy(true);
    try { await api.post("/whatsapp/logout"); } finally { setBusy(false); }
  }

  async function restart() {
    setBusy(true);
    try { await api.post("/whatsapp/restart"); } finally { setBusy(false); }
  }

  const showQr = status.state === "AWAITING_QR" && qrPayload?.qr;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp"
        subtitle={me ? `Connected as ${me}` : "Not connected"}
        actions={
          <>
            <Button onClick={restart} disabled={busy} size="sm" variant="outline">
              <RefreshCw className="h-3.5 w-3.5" />
              Restart worker
            </Button>
            <Button
              onClick={logout}
              disabled={busy || status.state !== "READY"}
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout number
            </Button>
          </>
        }
      />

      <main className="flex flex-1 items-start justify-center p-8">
        <div className="w-full max-w-xl space-y-4 animate-fade-in">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Dot variant={STATE_VARIANT[status.state] || "muted"} />
                    <span className="text-sm font-semibold">
                      {STATE_LABEL[status.state] || status.state}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Worker
                  </div>
                  <div className="mt-1">
                    <Badge variant={worker.alive ? "success" : "destructive"}>
                      {worker.alive ? "alive" : "no heartbeat"}
                    </Badge>
                  </div>
                </div>
              </div>

              {status.info && (
                <div className="text-xs text-muted-foreground">Info: {String(status.info)}</div>
              )}

              {showQr ? (
                <div className="flex flex-col items-center gap-3 py-2 animate-fade-in">
                  <canvas ref={canvasRef} className="rounded-md border bg-card p-3" />
                  <p className="max-w-md text-center text-xs text-muted-foreground">
                    Open WhatsApp on your phone → Settings → Linked Devices →{" "}
                    Link a device → scan this code.
                  </p>
                </div>
              ) : status.state === "READY" ? (
                <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                  Connected and ready to send/receive messages.
                </div>
              ) : status.state === "AUTHENTICATING" ? (
                <div className="rounded-md border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
                  Authenticating with WhatsApp servers…
                </div>
              ) : (
                <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                  Start the wa-worker process (
                  <code className="rounded bg-card px-1 font-mono text-xs">npm run dev:wa</code> or{" "}
                  <code className="rounded bg-card px-1 font-mono text-xs">pm2 start sa-wa-worker</code>) to begin.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
