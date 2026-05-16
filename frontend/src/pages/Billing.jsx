// M11.C3a — Billing page. Read-only foundation: shows the tenant's
// current plan + status + period dates, plus a comparison of all
// available plans. Upgrade/downgrade flow comes in C.3b (Stripe Checkout).

import { useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, Gauge } from "lucide-react";
import { api } from "../lib/api.js";
import { toast } from "../stores/toastStore.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

// Human-friendly labels for the quota keys returned by /billing/usage.
// Order matters — UI renders in this order. Keys not in this map fall
// through with their raw name (defensive — operators can add custom
// limits without code changes here).
const QUOTA_LABELS = [
  ["messages_per_month", "Messages this month"],
  ["ai_replies_per_month", "AI replies this month"],
  ["contacts_max", "Contacts"],
  ["automations_max", "Automations"],
  ["channels_max", "Channels"],
  ["seats_max", "Team seats"],
];

export default function Billing() {
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get("/billing/subscription").then((r) => r.data).catch(() => null),
      api.get("/billing/plans").then((r) => r.data.items).catch(() => []),
      api.get("/billing/usage").then((r) => r.data).catch(() => null),
    ])
      .then(([sub, list, u]) => {
        if (!cancelled) {
          setSubscription(sub);
          setPlans(list);
          setUsage(u);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={CreditCard}
        title="Billing"
        subtitle="Your subscription · plan limits · upgrade options"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {loading ? (
            <>
              <Skeleton className="h-32" />
              <Skeleton className="h-72" />
            </>
          ) : (
            <>
              {subscription && <CurrentPlanCard sub={subscription} />}
              {usage && <UsageCard usage={usage} />}
              <section>
                <h2 className="mb-3 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  All plans
                </h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {plans.map((p) => (
                    <PlanCard
                      key={p.id}
                      plan={p}
                      current={subscription?.plan?.slug === p.slug}
                    />
                  ))}
                </div>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Free / enterprise tiers don't go through Checkout. Plans
                  without a Stripe price configured are operator-managed —
                  ask your admin to wire them up.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CurrentPlanCard({ sub }) {
  const renewsAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const [portalBusy, setPortalBusy] = useState(false);

  async function openPortal() {
    setPortalBusy(true);
    try {
      const { data } = await api.post("/billing/portal");
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error("Portal didn't return a URL");
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Couldn't open billing portal");
      setPortalBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Current plan
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight">{sub.plan.name}</span>
              <span className="text-sm text-muted-foreground">
                {sub.plan.monthlyPriceCents === 0
                  ? "free"
                  : `${formatMoney(sub.plan.monthlyPriceCents, sub.plan.currency)} / mo`}
              </span>
            </div>
            {sub.plan.description && (
              <p className="mt-1.5 text-xs text-muted-foreground">{sub.plan.description}</p>
            )}
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              sub.status === "ACTIVE" && "bg-success/15 text-success",
              sub.status === "TRIALING" && "bg-info/15 text-info",
              sub.status === "PAST_DUE" && "bg-warning/15 text-warning",
              (sub.status === "CANCELLED" || sub.status === "EXPIRED") &&
                "bg-destructive/15 text-destructive",
            )}
          >
            {sub.status}
          </span>
        </div>
        {renewsAt && (
          <p className="mt-3 text-xs text-muted-foreground">
            {sub.cancelAtPeriodEnd ? "Cancels on " : "Renews on "}
            {renewsAt.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
        {/* Stripe Customer Portal — only when the tenant has a customer
            on file (i.e. completed at least one Checkout). */}
        {sub.hasStripeCustomer && (
          <div className="mt-4 flex justify-end">
            <Button size="sm" variant="outline" onClick={openPortal} disabled={portalBusy}>
              <ExternalLink className="h-3.5 w-3.5" />
              {portalBusy ? "Opening…" : "Manage subscription"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanCard({ plan, current }) {
  const isFree = plan.monthlyPriceCents === 0;
  const [busy, setBusy] = useState(false);
  const canCheckout = !current && !isFree && plan.hasStripePrice;

  async function choose() {
    setBusy(true);
    try {
      const { data } = await api.post("/billing/checkout", { planSlug: plan.slug });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error("Checkout didn't return a URL");
      }
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Couldn't start checkout");
      setBusy(false);
    }
  }

  let ctaLabel = "Choose";
  let ctaTitle;
  if (current) {
    ctaLabel = "Current";
  } else if (isFree && plan.slug === "free") {
    ctaLabel = "Default";
    ctaTitle = "All new signups land here automatically.";
  } else if (isFree) {
    ctaLabel = "Contact us";
    ctaTitle = "Custom plans aren't self-serve — reach out to discuss.";
  } else if (!plan.hasStripePrice) {
    ctaLabel = "Not yet available";
    ctaTitle =
      "Operator hasn't pasted a Stripe Price ID for this plan yet. PATCH /api/billing/plans/" +
      plan.slug +
      " { stripePriceId: 'price_xxx' }";
  }

  return (
    <Card className={cn("relative", current && "border-primary")}>
      <CardContent className="flex h-full flex-col p-5">
        {current && (
          <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            Current
          </span>
        )}
        <div className="text-lg font-semibold tracking-tight">{plan.name}</div>
        <div className="mt-1 text-sm">
          {isFree && plan.slug === "free" ? (
            <span className="text-muted-foreground">Free forever</span>
          ) : isFree ? (
            <span className="text-muted-foreground">Contact us</span>
          ) : (
            <>
              <span className="text-2xl font-semibold">
                {formatMoney(plan.monthlyPriceCents, plan.currency)}
              </span>
              <span className="text-xs text-muted-foreground"> / month</span>
            </>
          )}
        </div>
        {plan.description && (
          <p className="mt-2 text-xs text-muted-foreground">{plan.description}</p>
        )}
        <ul className="mt-4 flex-1 space-y-1.5">
          {(plan.features || []).map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={!canCheckout || busy}
          onClick={canCheckout ? choose : undefined}
          title={ctaTitle}
          className={cn(
            "mt-4 rounded-md border px-3 py-1.5 text-xs font-medium",
            canCheckout
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          {busy ? "Redirecting…" : ctaLabel}
        </button>
      </CardContent>
    </Card>
  );
}

// M11.C3c — usage card. Renders a row per quota key with the current
// used number and a progress bar against the plan's limit. Null limit
// renders as "Unlimited" with no bar. >=80% used renders the bar
// amber; >=100% renders red so over-quota tenants notice immediately.
function UsageCard({ usage }) {
  const rows = QUOTA_LABELS.map(([key, label]) => {
    const item = usage.items?.[key];
    if (!item) return null;
    return { key, label, used: item.used, limit: item.limit };
  }).filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Current usage</h3>
          {usage.plan?.name && (
            <span className="text-xs text-muted-foreground">· {usage.plan.name} plan</span>
          )}
        </div>
        <div className="space-y-3">
          {rows.map((r) => (
            <UsageRow key={r.key} {...r} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UsageRow({ label, used, limit }) {
  const unlimited = limit == null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const barColor = unlimited
    ? "bg-success"
    : pct >= 100
    ? "bg-destructive"
    : pct >= 80
    ? "bg-warning"
    : "bg-primary";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {used}
          {!unlimited && (
            <span className="text-muted-foreground"> / {limit}</span>
          )}
          {unlimited && <span className="text-muted-foreground"> · unlimited</span>}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full transition-all", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatMoney(cents, currency) {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
