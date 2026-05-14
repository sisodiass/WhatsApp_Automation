/*!
 * SalesAutomation embeddable widget loader.
 *
 * Customer drops:
 *   <script src="https://crm.example.com/widget.js" data-api-key="site_..." async></script>
 *
 * The loader:
 *   1. Reads its own <script> tag for `data-api-key` (and optional
 *      `data-api-base` to override the API origin).
 *   2. Fetches /public/widget/config to get appearance + behavior.
 *   3. Mounts a floating chat bubble in a Shadow DOM root so the host
 *      page's CSS can't touch us.
 *   4. On first message: calls /public/widget/session to bootstrap a
 *      session (passing window UTMs + referrer + landing page), then
 *      /public/chat/send for every message + a poll loop on
 *      /public/chat/messages for replies.
 *   5. Persists sessionToken + visitorId in localStorage so reloading
 *      the page keeps the conversation.
 *
 * Single file, zero deps, no framework. Should remain under ~10 KB
 * gzipped so the host page's perf budget isn't impacted.
 */
(function () {
  "use strict";
  if (window.__SA_WIDGET_LOADED__) return;
  window.__SA_WIDGET_LOADED__ = true;

  // ─── Resolve config from <script> tag ──────────────────────────
  var script = document.currentScript
    || document.querySelector('script[src*="widget.js"]');
  if (!script) return;
  var API_KEY = script.getAttribute("data-api-key");
  if (!API_KEY) {
    console.warn("[SA-widget] missing data-api-key attribute");
    return;
  }
  // Default API base = same origin as widget.js. Override with
  // data-api-base for cross-origin deployments.
  var srcUrl = new URL(script.src, location.href);
  var API_BASE = script.getAttribute("data-api-base") || srcUrl.origin;

  var STORAGE_KEY = "sa-widget:" + API_KEY.slice(-8);
  function loadStorage() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveStorage(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }

  // ─── UTM / referrer / landing-page capture ─────────────────────
  function gatherContext() {
    var q = new URLSearchParams(location.search);
    return {
      utm_source: q.get("utm_source") || undefined,
      utm_medium: q.get("utm_medium") || undefined,
      utm_campaign: q.get("utm_campaign") || undefined,
      ad_id: q.get("ad_id") || q.get("adid") || undefined,
      landingPage: location.href.length <= 2048 ? location.href : undefined,
      referrer: (document.referrer || "").length <= 2048 ? document.referrer : undefined,
    };
  }

  // ─── API helpers ───────────────────────────────────────────────
  function apiHeaders(extra) {
    var h = { "Content-Type": "application/json", "X-Api-Key": API_KEY };
    var state = loadStorage();
    if (state.sessionToken) h["Authorization"] = "Bearer " + state.sessionToken;
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }
  function apiGet(path) {
    return fetch(API_BASE + path, { headers: apiHeaders() }).then(parse);
  }
  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(body || {}),
    }).then(parse);
  }
  function parse(r) {
    return r.json().then(function (data) {
      if (!r.ok) throw new Error((data && data.error && data.error.message) || ("HTTP " + r.status));
      return data;
    });
  }

  // ─── Shadow DOM mount ──────────────────────────────────────────
  function mount(config) {
    if (!config.widgetEnabled) return;

    var host = document.createElement("div");
    host.id = "sa-widget-host";
    host.style.cssText = "position:fixed;z-index:2147483647;" +
      (config.position === "bottom-left" ? "left:16px;" : "right:16px;") +
      "bottom:16px;";
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });

    root.innerHTML = renderTemplate(config);
    var els = {
      bubble: root.querySelector(".bubble"),
      panel: root.querySelector(".panel"),
      list: root.querySelector(".messages"),
      input: root.querySelector(".input"),
      form: root.querySelector(".form"),
      intro: root.querySelector(".intro"),
      introStart: root.querySelector(".intro-start"),
      introName: root.querySelector(".intro-name"),
      introEmail: root.querySelector(".intro-email"),
      introPhone: root.querySelector(".intro-phone"),
      whatsappCta: root.querySelector(".wa-cta"),
      closeBtn: root.querySelector(".close"),
    };

    var state = loadStorage();
    var seen = new Set();
    var pollTimer = null;
    var open = false;

    function setOpen(o) {
      open = o;
      els.panel.classList.toggle("open", o);
      if (o && state.sessionToken) startPolling();
    }

    els.bubble.addEventListener("click", function () { setOpen(!open); });
    els.closeBtn.addEventListener("click", function () { setOpen(false); });

    function appendMsg(m) {
      if (m.id && seen.has(m.id)) return;
      if (m.id) seen.add(m.id);
      var div = document.createElement("div");
      var who = m.source === "SYSTEM" ? "sys" : (m.direction === "IN" ? "me" : "them");
      div.className = "msg msg-" + who;
      div.textContent = m.body;
      els.list.appendChild(div);
      els.list.scrollTop = els.list.scrollHeight;
      if (m.createdAt && (!state.lastTs || m.createdAt > state.lastTs)) {
        state.lastTs = m.createdAt;
        saveStorage(state);
      }
    }

    // Restore visible state if we have a session.
    if (state.sessionToken) {
      hideIntro();
      pullHistory();
    }

    if (els.introStart) {
      els.introStart.addEventListener("click", startSession);
    }
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      sendMessage();
    });

    function hideIntro() {
      els.intro.style.display = "none";
      els.form.style.display = "flex";
    }
    function showIntro() {
      els.intro.style.display = "flex";
      els.form.style.display = "none";
    }

    function startSession() {
      var ctx = gatherContext();
      var name = (els.introName && els.introName.value.trim()) || undefined;
      var nameParts = name ? name.split(/\s+/) : [];
      var payload = Object.assign({}, ctx, {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || undefined,
        email: (els.introEmail && els.introEmail.value.trim()) || undefined,
        mobile: (els.introPhone && els.introPhone.value.trim()) || undefined,
        source: "webchat",
      });
      els.introStart.disabled = true;
      apiPost("/public/widget/session", payload).then(function (r) {
        state.sessionToken = r.sessionToken;
        state.sessionId = r.sessionId;
        state.visitorId = r.visitorId;
        saveStorage(state);
        hideIntro();
        appendMsg({ source: "SYSTEM", direction: "OUT", body: "Connected. We'll get back to you shortly.", createdAt: new Date().toISOString() });
        startPolling();
      }).catch(function (err) {
        showError(err.message);
      }).then(function () {
        if (els.introStart) els.introStart.disabled = false;
      });
    }

    function sendMessage() {
      var body = els.input.value.trim();
      if (!body || !state.sessionToken) return;
      els.input.value = "";
      apiPost("/public/chat/send", { body: body }).then(appendMsg).catch(function (err) {
        showError(err.message);
      });
    }

    function pullHistory() {
      var q = state.lastTs ? "?since=" + encodeURIComponent(state.lastTs) : "";
      apiGet("/public/chat/messages" + q).then(function (r) {
        (r.items || []).forEach(appendMsg);
      }).catch(function () { /* network blip — try next tick */ });
    }
    function startPolling() {
      if (pollTimer) return;
      pullHistory();
      pollTimer = setInterval(pullHistory, 4000);
    }

    function showError(msg) {
      // Inline error bubble inside the messages area; auto-dismisses on next op.
      var div = document.createElement("div");
      div.className = "msg msg-sys";
      div.textContent = "⚠ " + msg;
      els.list.appendChild(div);
    }
  }

  function renderTemplate(config) {
    var color = config.primaryColor || "#2563eb";
    var welcome = (config.welcomeText || "Hi 👋 — how can we help?").replace(/[<>]/g, "");
    var title = (config.headerTitle || "Chat with us").replace(/[<>]/g, "");
    var placeholder = (config.placeholder || "Type a message…").replace(/"/g, "&quot;");
    var requireEmail = !!config.requireEmail;
    var requirePhone = !!config.requirePhone;
    var waHref = config.whatsappNumber
      ? "https://wa.me/" + String(config.whatsappNumber).replace(/[^\d]/g, "")
      : null;

    return [
      '<style>',
      ':host{all:initial;font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;}',
      '*{box-sizing:border-box;}',
      '.bubble{width:56px;height:56px;border-radius:50%;background:' + color + ';color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.18);font-size:22px;border:0;}',
      '.bubble:hover{transform:scale(1.04);transition:transform .12s ease;}',
      '.panel{position:absolute;bottom:72px;' + (config.position === "bottom-left" ? "left:0;" : "right:0;") + 'width:340px;max-width:calc(100vw - 32px);height:480px;max-height:70vh;background:#fff;color:#0b0d10;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.08);}',
      '.panel.open{display:flex;}',
      '.head{background:' + color + ';color:#fff;padding:12px 14px;font-weight:600;display:flex;align-items:center;justify-content:space-between;}',
      '.close{background:transparent;border:0;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;}',
      '.messages{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:#f7f7f8;}',
      '.msg{max-width:80%;padding:8px 10px;border-radius:10px;font-size:14px;line-height:1.35;word-wrap:break-word;}',
      '.msg-me{background:' + color + ';color:#fff;align-self:flex-end;border-bottom-right-radius:2px;}',
      '.msg-them{background:#fff;color:#0b0d10;align-self:flex-start;border:1px solid rgba(0,0,0,.06);border-bottom-left-radius:2px;}',
      '.msg-sys{background:transparent;color:#6b7280;align-self:center;font-style:italic;font-size:12px;}',
      '.intro{padding:14px;display:flex;flex-direction:column;gap:8px;background:#fff;}',
      '.intro h3{margin:0;font-size:15px;color:#0b0d10;}',
      '.intro p{margin:0;color:#6b7280;font-size:13px;}',
      '.intro input{padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;}',
      '.intro-start{background:' + color + ';color:#fff;border:0;padding:9px;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px;}',
      '.wa-cta{display:flex;align-items:center;justify-content:center;gap:6px;background:#25d366;color:#fff;border:0;text-decoration:none;padding:9px;border-radius:6px;font-weight:600;font-size:13px;}',
      '.form{display:none;padding:10px;border-top:1px solid #e5e7eb;background:#fff;gap:6px;}',
      '.input{flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;}',
      '.send{background:' + color + ';color:#fff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:14px;}',
      '</style>',
      '<button class="bubble" aria-label="Open chat">💬</button>',
      '<div class="panel" role="dialog" aria-label="' + title + '">',
        '<div class="head"><span>' + title + '</span><button class="close" aria-label="Close">×</button></div>',
        '<div class="messages"></div>',
        '<div class="intro">',
          '<h3>' + welcome + '</h3>',
          '<p>Leave your details and we\'ll reply here.</p>',
          '<input class="intro-name" type="text" placeholder="Your name" autocomplete="name" />',
          '<input class="intro-email" type="email" placeholder="Email' + (requireEmail ? '' : ' (optional)') + '" autocomplete="email"' + (requireEmail ? ' required' : '') + ' />',
          '<input class="intro-phone" type="tel" placeholder="Mobile' + (requirePhone ? '' : ' (optional)') + '" autocomplete="tel"' + (requirePhone ? ' required' : '') + ' />',
          '<button class="intro-start" type="button">Start chat</button>',
          waHref ? '<a class="wa-cta" href="' + waHref + '" target="_blank" rel="noopener">Or chat on WhatsApp</a>' : '',
        '</div>',
        '<form class="form" autocomplete="off">',
          '<input class="input" type="text" placeholder="' + placeholder + '" />',
          '<button class="send" type="submit">Send</button>',
        '</form>',
      '</div>',
    ].join("");
  }

  // ─── Boot ──────────────────────────────────────────────────────
  apiGet("/public/widget/config").then(function (cfg) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { mount(cfg); });
    } else {
      mount(cfg);
    }
  }).catch(function (err) {
    console.warn("[SA-widget] config fetch failed:", err.message);
  });
})();
