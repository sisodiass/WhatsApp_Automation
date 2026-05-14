import { useEffect, useState } from "react";
import { Facebook, Globe, Instagram, MessageCircle, Power, PowerOff } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card } from "../components/ui/Card.jsx";
import { Input } from "../components/ui/Input.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";

const TYPE_META = {
  WHATSAPP:     { label: "WhatsApp",            icon: MessageCircle, fields: [] },
  WEB_CHAT:     { label: "Web Chat",            icon: Globe,         fields: [] },
  INSTAGRAM:    { label: "Instagram",           icon: Instagram,     fields: META_FIELDS() },
  FB_MESSENGER: { label: "Facebook Messenger",  icon: Facebook,      fields: META_FIELDS() },
};

function META_FIELDS() {
  return [
    { key: "pageId",          label: "Page ID",           secret: false },
    { key: "pageAccessToken", label: "Page Access Token", secret: true  },
    { key: "appSecret",       label: "App Secret",        secret: true  },
    { key: "verifyToken",     label: "Verify Token",      secret: true  },
  ];
}

export default function Channels() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get("/channels");
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={MessageCircle}
        title="Channels"
        subtitle="Configure the providers your customers can message you on"
      />
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {["WHATSAPP", "WEB_CHAT", "INSTAGRAM", "FB_MESSENGER"].map((type) => {
              const channel = items.find((c) => c.type === type);
              const meta = TYPE_META[type];
              const Icon = meta.icon;
              const configured = type === "WHATSAPP" || type === "WEB_CHAT"
                ? Boolean(channel)
                : Boolean(channel?.config?.pageId);
              return (
                <Card key={type}>
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{meta.label}</span>
                          {channel?.isActive === false && (
                            <Badge variant="muted">paused</Badge>
                          )}
                          {!configured && meta.fields.length > 0 && (
                            <Badge variant="muted">not configured</Badge>
                          )}
                          {configured && channel?.isActive && (
                            <Badge variant="success">live</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {channel?._count?.chats ?? 0} chats on this channel
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {meta.fields.length > 0 && (
                          <Button size="xs" variant="outline" onClick={() => setEditing(type)}>
                            Configure
                          </Button>
                        )}
                        {channel && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={async () => {
                              await api.put(`/channels/${type}`, { isActive: !channel.isActive });
                              await load();
                            }}
                          >
                            {channel.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <EditorModal type={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EditorModal({ type, onClose, onSaved }) {
  const meta = TYPE_META[type];
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/channels/${type}`)
      .then(({ data }) => {
        if (cancelled) return;
        setForm({
          name: data.name || meta.label,
          isActive: data.isActive ?? true,
          ...(data.config || {}),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setForm({ name: meta.label, isActive: true });
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [type, meta.label]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const config = {};
      for (const f of meta.fields) {
        const v = form[f.key];
        if (v !== undefined && v !== "") config[f.key] = v;
      }
      await api.put(`/channels/${type}`, {
        name: form.name,
        isActive: form.isActive,
        config,
      });
      toast.success(`Saved ${meta.label}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-foreground/30 p-4 animate-fade-in">
      <form onSubmit={save} className="w-full max-w-lg animate-slide-up">
        <Card>
          <div className="border-b px-5 py-3">
            <h2 className="text-base font-semibold tracking-tight">Configure {meta.label}</h2>
          </div>
          <div className="space-y-3 p-5">
            {loading ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <Field label="Display name">
                  <Input
                    value={form.name || ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                {meta.fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Input
                      type={f.secret ? "password" : "text"}
                      value={form[f.key] || ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      placeholder={f.secret ? "•••••••" : ""}
                    />
                  </Field>
                ))}
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isActive !== false}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <span>Active</span>
                </label>
                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Webhook URL:{" "}
                  <code className="rounded bg-background px-1 font-mono">
                    {(import.meta.env.VITE_PUBLIC_URL || window.location.origin) + "/api/webhooks/meta/" + (type === "INSTAGRAM" ? "instagram" : "messenger")}
                  </code>
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || loading}>Save</Button>
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
