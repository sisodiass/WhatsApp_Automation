// Unit tests for the M11.D5 email template renderer. Pure string
// transformation — no DB, no network. Run via `npm test`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderNotificationEmail } from "../../src/modules/email/email.service.js";

describe("renderNotificationEmail", () => {
  test("includes the title as both subject material and inline H1", () => {
    const { html, text } = renderNotificationEmail({
      title: "Outbound message delivery failed after 5 attempts",
    });
    assert.match(html, /Outbound message delivery failed after 5 attempts/);
    assert.match(text, /Outbound message delivery failed after 5 attempts/);
  });

  test("HTML-escapes the title to prevent injection", () => {
    const { html } = renderNotificationEmail({
      title: '<script>alert("xss")</script>',
    });
    assert.ok(
      !html.includes("<script>"),
      "raw <script> tag must not appear in output",
    );
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&quot;xss&quot;/);
  });

  test("body newlines convert to <br> in HTML, preserved as \\n in text", () => {
    const { html, text } = renderNotificationEmail({
      title: "Multi-line",
      body: "Line 1\nLine 2\nLine 3",
    });
    assert.match(html, /Line 1<br>Line 2<br>Line 3/);
    assert.match(text, /Line 1\nLine 2\nLine 3/);
  });

  test("CTA button rendered only when url is provided", () => {
    const without = renderNotificationEmail({ title: "x" });
    assert.ok(!without.html.includes("Open"));

    const withUrl = renderNotificationEmail({
      title: "x",
      url: "https://app.example.com/leads/abc",
    });
    assert.match(withUrl.html, /Open/);
    assert.match(withUrl.html, /https:\/\/app\.example\.com\/leads\/abc/);
  });

  test("custom urlLabel is honored", () => {
    const { html, text } = renderNotificationEmail({
      title: "x",
      url: "/leads/abc",
      urlLabel: "Review now",
    });
    assert.match(html, /Review now/);
    assert.match(text, /Review now:/);
  });

  test("body is optional — omitted when empty/null", () => {
    const { html } = renderNotificationEmail({ title: "x" });
    // The body <tr> should be entirely absent (not present-but-empty).
    assert.ok(!html.includes('padding: 0 32px 16px 32px'));
  });

  test("output is well-formed: <!DOCTYPE, <html>, closing tags", () => {
    const { html } = renderNotificationEmail({ title: "x", body: "y", url: "/z" });
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<\/html>\s*$/);
    // Roughly balanced.
    const openTr = (html.match(/<tr>/g) || []).length;
    const closeTr = (html.match(/<\/tr>/g) || []).length;
    assert.equal(openTr, closeTr);
  });

  test("plain-text fallback ends with the brand line", () => {
    const { text } = renderNotificationEmail({ title: "Hello" });
    assert.match(text, /Sent by SalesAutomation\.$/);
  });
});
