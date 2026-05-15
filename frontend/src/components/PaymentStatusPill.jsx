import { Badge } from "./ui/Badge.jsx";

const QUOTATION_VARIANTS = {
  DRAFT: "muted",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "destructive",
  EXPIRED: "warning",
  REVISED: "muted",
};

const LINK_VARIANTS = {
  CREATED: "muted",
  PENDING: "info",
  PAID: "success",
  FAILED: "destructive",
  EXPIRED: "warning",
  REFUNDED: "warning",
  CANCELLED: "muted",
};

const TXN_VARIANTS = {
  AUTHORIZED: "info",
  CAPTURED: "success",
  FAILED: "destructive",
  REFUNDED: "warning",
  PARTIALLY_REFUNDED: "warning",
};

export function QuotationStatusPill({ status }) {
  return <Badge variant={QUOTATION_VARIANTS[status] || "default"}>{status}</Badge>;
}

export function PaymentLinkStatusPill({ status }) {
  return <Badge variant={LINK_VARIANTS[status] || "default"}>{status}</Badge>;
}

export function TxnStatusPill({ status }) {
  return <Badge variant={TXN_VARIANTS[status] || "default"}>{status}</Badge>;
}
