// M11.C3a — Billing page. Read-only foundation: shows the tenant's
// current plan + status + period dates, plus a comparison of all
// available plans. Upgrade/downgrade flow comes in C.3b (Stripe Checkout).

import { useEffect, useState } from "react";
import { Check, CreditCard } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader } from "../components/ui/PageHeader.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { cn } from "../lib/cn.js";

export default function Billing() {
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get("/billing/subscription").then((r) => r.data).catch(() => null),
      api.get("/billing/plans").then((r) => r.data.items).catch(() => []),
    ])
      .then(([sub, list]) => {
        if (!cancelled) {
          setSubscription(sub);
          setPlans(list);
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
                  Upgrade / downgrade flow ships with the Stripe integration in
                  the next release.
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
      </CardContent>
    </Card>
  );
}

function PlanCard({ plan, current }) {
  const isFree = plan.monthlyPriceCents === 0;
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
        {/* Upgrade CTA placeholder — wired in C.3b. */}
        <button
          type="button"
          disabled
          className="mt-4 rounded-md border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground"
          title="Upgrade flow ships with Stripe in the next release."
        >
          {current ? "Current" : "Choose"}
        </button>
      </CardContent>
    </Card>
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
