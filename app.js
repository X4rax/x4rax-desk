/* X4rax Desk front-end (PAPER, read-only). No secrets live in this file.
   Files: chart.js (canvas charts) · ui.js (components, formatting) · app.js (this file: router, pairing, polling, data store) ·
   screens-flow.js (#fomo #init #pipeline) · screens-dash.js (#dashboard #positions #scanner #coin) · boot.js (starts the app).
   Screens (hash router): #splash (animated logo, ~2s) -> #pair when no device token. A paired phone that has already seen the start-up
   flow goes splash -> #dashboard. The first launch (no localStorage flag x4_startup_seen), or "Show startup", plays
   splash -> #fomo -> #init -> #pipeline -> #dashboard. Tabs: #dashboard #positions #scanner #pipeline #fomo; #coin is a detail view.
   Data: every screen renders only what the Worker returned (state, pulse, portfolio, market, wallet, coin, audit, decisions).
   A key the Worker does not have yet (404, e.g. the deployed Worker before its upgrade) is reported as "unavailable" and re-checked
   slowly (60 s); nothing is made up to fill the gap.
   Polling (visible page only): state 15 s, pulse 5 s (start-up/pipeline/dashboard), portfolio+market 30 s, wallet 60 s (#fomo).
   Security notes:
   - The iPhone signs in with a per-device token obtained by typing a
     short-lived pairing code (POST /api/pair/redeem). The long-lived
     APP_TOKEN never enters Safari, the URL, or this file.
   - The device token is stored in localStorage and sent only as an
     Authorization Bearer header to the Worker. It is never placed in a
     URL or query string. Redeem happens over a JSON body; the token
     arrives in the response body (Cache-Control: no-store).
   - The only hash values kept are the screen names (#pair, #fomo, ...). A leftover #t= fragment
     from an older sign-in flow, or any other hash, is wiped and ignored.
   - The token is cleared on any 401, and by opening the app with #logout
     (which also calls POST /api/pair/revoke-self when possible).
   - API data is never inserted as HTML; only textContent is used. The
     pairing screen uses createElement / textContent / addEventListener;
     there is no <form> (CSP form-action is 'none'). No inline styles.
   - The app can only GET snapshots (and pair / revoke itself). It has no wallet, signing or order code: it cannot trade,
     send funds, change the mode or change a desk setting.
   - API_BASE is the Cloudflare Worker origin (https://<worker>.workers.dev).
     index.html's Content-Security-Policy connect-src must allow that origin.
   - Polling pauses completely when the page is hidden, frozen, or on the pairing screen. Overlapping fetches
     are skipped; each fetch is aborted after 10 seconds. Network errors
     back off 10s -> 20s -> 40s -> 60s (cap) and reset on success.
   - If the newest heartbeat or the snapshot_at timestamp is more than
     two minutes old, a small banner (textContent only) shows
     "Desk data is stale since HH:MM".
   - FOMO links (profile, invite, coin pages) are rendered only from the API payload. This file never builds a FOMO URL.
     A link is shown only if it is https and carries the referral code the payload names
     (link_ref). Each one has a caption (link_note) saying it only opens
     FOMO, the desk places no orders, and you trade there yourself. Links
     open with rel="noopener noreferrer"; text goes in with textContent. */
(function () {
  "use strict";
  var API_BASE = "https://x4rax-desk.riadh-ferjani02.workers.dev"; /* Cloudflare Worker origin */
  var KEY = "device_token";
  var SEEN_KEY = "x4_startup_seen";
  var TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
  var MINT_RE = /^[A-Za-z0-9]{32,64}$/;
  var BACKOFF_START_MS = 10000;
  var BACKOFF_CAP_MS = 60000;
  var FETCH_TIMEOUT_MS = 10000;
  var STALE_MS = 120000;
  var UNAVAILABLE_RECHECK_MS = 60000;
  var UI = window.DeskUI;
  var ROUTES = ["splash", "pair", "fomo", "init", "pipeline", "dashboard", "positions", "scanner", "coin", "analytics", "settings", "alerts"];
  var FLOW_ROUTES = { fomo: 1, init: 1, pipeline: 1 };
  var TAB_ROUTES = { dashboard: "dashboard", positions: "positions", scanner: "scanner", pipeline: "pipeline", analytics: "analytics", settings: "settings", alerts: "settings", fomo: "settings", coin: "positions" };
  /* What each polled key is, how often, and on which screens it is needed ("*" = everywhere). */
  var PLAN = {
    state: { path: "/api/state", ms: 15000, on: "*" },
    pulse: { path: "/api/pulse", ms: 5000, on: ["init", "pipeline", "dashboard"] },
    portfolio: { path: "/api/portfolio", ms: 30000, on: ["dashboard", "positions", "coin"] },
    market: { path: "/api/market", ms: 30000, on: ["dashboard", "scanner", "coin"] },
    wallet: { path: "/api/wallet", ms: 60000, on: ["fomo"] },
    analytics: { path: "/api/analytics", ms: 60000, on: ["analytics", "alerts", "settings"] },
    settings: { path: "/api/settings", ms: 120000, on: ["settings"] }
  };
  var D = {};          /* key -> latest payload (only what the Worker returned) */
  var M = {};          /* key -> { at, status, unavailable, error } fetch bookkeeping */
  var X = { coin: {}, audit: {}, decisions: {}, chart: {} };   /* on-demand payloads by mint / agent */
  var XM = {};         /* on-demand bookkeeping, same shape as M */
  var handlers = {};
  var screens = Array.prototype.slice.call(document.querySelectorAll(".screen"));
  var currentRoute = "";
  var splashing = false;
  var afterSplash = "";
  var flow = false;
  var selMint = "";
  var heartbeatsEl = document.getElementById("heartbeats");
  var modeEl = document.getElementById("mode");
  var staleBanner = null;
  var pairBox = null;
  var pollTimer = null;
  var inFlight = {};
  var ctls = {};
  var backoffMs = 0;

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function clearToken() { store(function (s) { s.removeItem(KEY); }); }
  /* The start-up flow is shown once per STARTUP_VERSION. Devices paired before this version stored "1", so after the upgrade they
     see the flow once (it introduces the new navigation and Analytics / Settings); "Show startup" in Settings replays it any time. */
  var STARTUP_VERSION = "2";
  function seen() { return store(function (s) { return s.getItem(SEEN_KEY); }) === STARTUP_VERSION; }
  function setSeen() { store(function (s) { s.setItem(SEEN_KEY, STARTUP_VERSION); }); }
  function forgetSeen() { store(function (s) { s.removeItem(SEEN_KEY); }); }

  function wipeFragment() { history.replaceState(null, "", location.pathname + location.search); }

  function readFragment() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return "ok";
    if (raw === "logout") {
      doLogout();
      return "logout";
    }
    if (ROUTES.indexOf(raw) !== -1) return "route";
    /* Older #t= private-link fragments: wipe and ignore. Never store them. */
    wipeFragment();
    return "ok";
  }

  function doLogout() {
    var existing = token();
    wipeFragment();
    if (existing) revokeSelf(existing);
    clearToken();
    forgetSeen();
    D = {}; M = {}; X.coin = {}; X.audit = {}; X.decisions = {}; X.chart = {};
    Object.keys(XM).forEach(function (k) { delete XM[k]; });
  }

  function routeFromHash() {
    var raw = (location.hash || "").replace(/^#/, "");
    return ROUTES.indexOf(raw) !== -1 ? raw : "";
  }

  /* ---- router: one visible .screen at a time ---- */
  function gate(route) {
    if (route !== "splash" && route !== "pair" && !token()) return "pair";
    if (route === "pair" && token()) return "dashboard";
    if (route === "coin" && !selMint) return "dashboard";
    return route;
  }

  function setFlow(on) {
    flow = !!on;
    if (flow) document.body.setAttribute("data-flow", "1");
    else document.body.removeAttribute("data-flow");
  }

  function render(route) {
    var prev = currentRoute;
    if (prev && handlers[prev] && handlers[prev].leave) { try { handlers[prev].leave(); } catch (e) {} }
    currentRoute = route;
    if (flow && !FLOW_ROUTES[route] && route !== "splash") {
      setFlow(false);                       /* left the start-up flow */
      if (route === "dashboard") setSeen();
    }
    document.body.setAttribute("data-route", route);
    var tab = TAB_ROUTES[route] || "";
    Array.prototype.forEach.call(document.querySelectorAll(".tabbar [data-go]"), function (b) {
      var on = b.getAttribute("data-go") === tab;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    var active = null;
    screens.forEach(function (s) {
      var on = s.getAttribute("data-screen") === route;
      s.hidden = !on;
      if (on) active = s;
    });
    try { window.scrollTo(0, 0); } catch (e) {}
    if (!active || route === "splash") return;
    if (route === "pair") {
      var input = document.getElementById("pair-code");
      if (input) { try { input.focus({ preventScroll: true }); } catch (e) {} }
      return;
    }
    var title = active.querySelector(".screen-title");
    if (title) { try { title.focus({ preventScroll: true }); } catch (e) {} }
    if (handlers[route] && handlers[route].enter) { try { handlers[route].enter(); } catch (e) { log("enter " + route, e); } }
    kick();
  }

  function log(where, e) { try { console.error("x4rax-desk " + where + ": " + (e && e.message ? e.message : e)); } catch (x) {} }

  /* mode "replace" rewrites the current history entry; otherwise a new entry is pushed (back works). */
  function go(route, mode) {
    if (splashing && route !== "splash") { afterSplash = route; return; }
    route = gate(route);
    if (route === currentRoute) return;
    var url = location.pathname + location.search + "#" + route;
    try {
      if (mode === "replace") history.replaceState(null, "", url);
      else history.pushState(null, "", url);
    } catch (e) {}
    render(route);
  }

  function startFlow() { setFlow(true); go("fomo"); }
  function endFlow(to) { setFlow(false); setSeen(); go(to || "dashboard"); }

  function afterLaunch() {
    if (!token()) return "pair";
    if (afterSplash && afterSplash !== "pair" && afterSplash !== "splash") return afterSplash;
    return seen() ? "dashboard" : "flow";
  }

  function startSplash() {
    var section = document.getElementById("screen-splash");
    splashing = true;
    try { history.replaceState(null, "", location.pathname + location.search + "#splash"); } catch (e) {}
    render("splash");
    UI.runSplash(section, function () {
      splashing = false;
      var next = afterLaunch();
      afterSplash = "";
      section.classList.remove("is-playing", "is-leaving");
      if (next === "flow") { setFlow(true); go("fomo", "replace"); }
      else go(next, "replace");
    });
  }

  function onHashChange() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (raw === "logout") {
      doLogout();
      showPairing("Enter the pairing code shown on the desk.");
      return;
    }
    var r = routeFromHash();
    if (!r) { wipeKeep(); return; }
    if (splashing) { afterSplash = r; wipeKeep(); return; }
    if (r === "splash") r = token() ? (seen() ? "dashboard" : "fomo") : "pair";
    var g = gate(r);
    if (g !== r) { try { history.replaceState(null, "", location.pathname + location.search + "#" + g); } catch (e) {} }
    if (g !== currentRoute) render(g);
  }

  /* Unknown hash while running: drop it, keep the visible screen's own hash. */
  function wipeKeep() {
    try { history.replaceState(null, "", location.pathname + location.search + (currentRoute ? "#" + currentRoute : "")); } catch (e) {}
  }

  function token() {
    var t = store(function (s) { return s.getItem(KEY); }) || "";
    if (t && !TOKEN_RE.test(t)) { clearToken(); return ""; }
    return t;
  }

  function isVisible() {
    return document.visibilityState === "visible";
  }

  function canPoll() {
    return isVisible() && !!token() && currentRoute !== "pair";
  }

  /* ---------------------------------------------------------------- data layer */
  function needed(route) {
    var r = route === "splash" ? "dashboard" : route;
    return Object.keys(PLAN).filter(function (k) { var on = PLAN[k].on; return on === "*" || on.indexOf(r) !== -1; });
  }

  function metaOf(k) { return M[k] || (M[k] = { at: 0, status: 0, unavailable: false, error: "" }); }
  function everyMs(k) { return metaOf(k).unavailable ? UNAVAILABLE_RECHECK_MS : PLAN[k].ms; }
  function isDue(k, now) { var m = metaOf(k); return !m.at || now - m.at >= everyMs(k) - 300; }

  function stopTimer() {
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function cancelFetches() {
    Object.keys(ctls).forEach(function (k) {
      var c = ctls[k];
      if (c) { clearTimeout(c.timer); try { c.ctl.abort(); } catch (e) {} }
    });
    ctls = {};
    inFlight = {};
  }

  function pausePolling() { stopTimer(); cancelFetches(); }

  /* GET one snapshot. Resolves {kind: ok|unavailable|auth|error|offline, status}. Never rejects. */
  function fetchJson(path, ctlKey) {
    var t = token();
    if (!t) return Promise.resolve({ kind: "auth", status: 401 });
    var ctl = new AbortController();
    var timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
    ctls[ctlKey] = { ctl: ctl, timer: timer };
    return fetch(API_BASE + path, {
      headers: { Authorization: "Bearer " + t },
      cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: ctl.signal
    }).then(function (res) {
      if (res.status === 401) return { kind: "auth", status: 401 };
      if (res.status === 404) return { kind: "unavailable", status: 404 };
      if (!res.ok) return { kind: "error", status: res.status };
      return res.json().then(function (data) { return { kind: "ok", status: 200, data: data }; });
    }).catch(function (err) {
      return { kind: "offline", status: 0, aborted: !!(err && err.name === "AbortError") };
    }).then(function (r) {
      clearTimeout(timer);
      delete ctls[ctlKey];
      return r;
    });
  }

  function onAuthLost() {
    clearToken();
    pausePolling();
    showPairing("Link expired or invalid. Pair this device again.");
  }

  function applyMeta(m, r) {
    m.status = r.status;
    if (r.kind === "ok") { m.at = Date.now(); m.unavailable = false; m.error = ""; }
    else if (r.kind === "unavailable") { m.at = Date.now(); m.unavailable = true; m.error = "unavailable"; }
    else { m.error = r.kind === "offline" ? "offline" : "http_" + r.status; }
  }

  function load(k) {
    if (inFlight[k]) return Promise.resolve({ kind: "busy" });
    inFlight[k] = true;
    var m = metaOf(k);
    return fetchJson(PLAN[k].path, k).then(function (r) {
      inFlight[k] = false;
      if (r.kind === "auth") { onAuthLost(); return r; }
      if (r.aborted && !canPoll()) return r;
      applyMeta(m, r);
      if (r.kind === "ok" && r.data && typeof r.data === "object") D[k] = r.data;
      return r;
    });
  }

  /* On-demand payloads (coin / audit / decisions): cached per id, re-fetched when older than ttl. */
  function ensure(kind, id, path, ttl) {
    var bag = X[kind], mk = kind + ":" + id;
    var m = XM[mk] || (XM[mk] = { at: 0, status: 0, unavailable: false, error: "" });
    if (inFlight[mk] || (m.at && Date.now() - m.at < (m.unavailable ? UNAVAILABLE_RECHECK_MS : ttl))) return Promise.resolve(m);
    inFlight[mk] = true;
    return fetchJson(path, mk).then(function (r) {
      inFlight[mk] = false;
      if (r.kind === "auth") { onAuthLost(); return m; }
      applyMeta(m, r);
      if (r.kind === "ok" && r.data && typeof r.data === "object") bag[id] = r.data;
      refreshScreen("x:" + kind);
      return m;
    });
  }

  function refreshScreen(what) {
    var h = handlers[currentRoute];
    if (h && h.update) { try { h.update(what); } catch (e) { log("update " + currentRoute, e); } }
  }

  function nextDelay(keys) {
    var now = Date.now(), d = 60000;
    keys.forEach(function (k) {
      var m = metaOf(k);
      d = Math.min(d, m.at ? Math.max(0, m.at + everyMs(k) - now) : 0);
    });
    return Math.max(1000, d, backoffMs);
  }

  function tick() {
    pollTimer = null;
    if (!canPoll()) return;
    var keys = needed(currentRoute), now = Date.now();
    var jobs = keys.filter(function (k) { return isDue(k, now); }).map(function (k) { return load(k).then(function (r) { return { k: k, r: r }; }); });
    Promise.all(jobs).then(function (results) {
      if (!canPoll()) return;
      var failed = results.some(function (x) { return x.r.kind === "offline" || x.r.kind === "error"; });
      backoffMs = failed ? Math.min(Math.max(backoffMs * 2, BACKOFF_START_MS), BACKOFF_CAP_MS) : 0;
      afterData(results);
      stopTimer();
      pollTimer = setTimeout(tick, nextDelay(needed(currentRoute)));
    });
  }

  /* Poll now (route change, wake-up, pairing done): fetch what is due for this screen. */
  function kick() {
    stopTimer();
    if (!canPoll()) return;
    pollTimer = setTimeout(tick, 0);
  }

  function afterData(results) {
    var st = M.state || {};
    if (D.state) {
      setMode(D.state.mode === "LIVE" ? "LIVE" : "PAPER");   /* the badge shows PAPER unless the server explicitly says LIVE */
      showHeartbeats(D.state.heartbeats);
      showFomo(D.state.fomo);
      document.body.setAttribute("data-demo", D.state.demo === true ? "1" : "0");
    }
    if (st.error === "offline" || (st.error && st.error.indexOf("http_") === 0)) {
      UI.setLink("offline");
      showOfflineBanner(st);
    } else if (D.state) {
      UI.setLink(updateStaleBanner(D.state) ? "stale" : "live");
    }
    refreshScreen("data");
  }

  function onHidden() { pausePolling(); }

  function onWake() {
    if (!canPoll()) {
      stopTimer();
      if (!token()) showPairing("Enter the pairing code shown on the desk.");
      return;
    }
    if (pollTimer !== null || Object.keys(inFlight).some(function (k) { return inFlight[k]; })) return;
    kick();
  }

  function showMessage(text) {
    if (!heartbeatsEl) return;
    var li = document.createElement("li");
    li.textContent = text;
    heartbeatsEl.replaceChildren(li);
  }

  function hideStaleBanner() {
    if (staleBanner && staleBanner.parentNode) staleBanner.parentNode.removeChild(staleBanner);
    staleBanner = null;
  }

  function showBanner(text, tone) {
    if (!staleBanner) {
      staleBanner = document.createElement("p");
      staleBanner.id = "stale-banner";
      staleBanner.setAttribute("role", "status");
      var header = document.querySelector("header") || document.querySelector("main") || document.body;
      header.appendChild(staleBanner);
    }
    staleBanner.setAttribute("data-tone", tone || "warn");
    staleBanner.textContent = text;
  }

  function showStaleBanner(sinceMs) {
    var when = new Date(sinceMs);
    var hhmm = isNaN(when.getTime())
      ? ""
      : when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    showBanner(hhmm ? ("Desk data is stale since " + hhmm) : "Desk data is stale", "warn");
  }

  function showOfflineBanner(st) {
    var at = D.state && D.state.health && D.state.health.snapshot_at;
    var t = at ? UI.fmt.clock(at) : "";
    showBanner((st.error === "offline" ? "You are offline." : "The desk link is unavailable (" + st.status + ").") +
      (t ? " Showing the last data from " + t + "." : " Nothing to show yet."), "bad");
  }

  function updateStaleBanner(data) {
    var newest = NaN;
    var health = data && data.health;
    var snapshotAt = health && health.snapshot_at;
    if (snapshotAt) {
      var snap = Date.parse(snapshotAt);
      if (!isNaN(snap)) newest = snap;
    }
    var hb = data && data.heartbeats;
    if (hb && typeof hb === "object") {
      Object.keys(hb).forEach(function (k) {
        var parsed = Date.parse(hb[k]);
        if (!isNaN(parsed) && (isNaN(newest) || parsed > newest)) newest = parsed;
      });
    }
    if (isNaN(newest)) { hideStaleBanner(); return false; }
    if (Date.now() - newest > STALE_MS) { showStaleBanner(newest); return true; }
    hideStaleBanner();
    return false;
  }

  function clockText(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  function agentStatus(iso) {
    var t = Date.parse(iso);
    return !isNaN(t) && Date.now() - t <= STALE_MS ? "running" : "stale";
  }

  var LABELS = { main: "Conductor", scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };

  function showHeartbeats(hb) {
    if (!heartbeatsEl || !hb || typeof hb !== "object") return;
    var items = Object.keys(hb).sort().map(function (k) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.className = "hb-name";
      name.textContent = LABELS[k] || String(k);
      var time = document.createElement("span");
      time.className = "hb-time";
      time.textContent = clockText(hb[k]);
      li.appendChild(UI.agentBadge(k, "sm", agentStatus(hb[k])));
      li.appendChild(name);
      li.appendChild(time);
      return li;
    });
    heartbeatsEl.replaceChildren.apply(heartbeatsEl, items);
    /* Roster badges elsewhere show the same real heartbeat status. */
    Array.prototype.forEach.call(document.querySelectorAll(".pair-roster .agent-badge"), function (b) {
      var k = b.getAttribute("data-agent");
      if (hb[k]) b.setAttribute("data-status", agentStatus(hb[k]));
    });
  }

  function setMode(m) {
    if (!modeEl) return;
    modeEl.textContent = m;
    modeEl.setAttribute("data-mode", m);
  }

  /* One view of an agent for every screen: the desk's own state (pulse) combined with the heartbeat age (state).
     status: scanning|analyzing|processing|idle|waiting|error (what the agent reported) or stale|stalled|paused|unknown|running. */
  function agentView(name) {
    var pa = null;
    var list = D.pulse && Array.isArray(D.pulse.agents) ? D.pulse.agents : [];
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].name === name) { pa = list[i]; break; } }
    var hb = D.state && D.state.heartbeats ? D.state.heartbeats[name] : null;
    var t = hb ? Date.parse(hb) : NaN;
    var age = isNaN(t) ? NaN : Date.now() - t;
    var status;
    var bad = !!pa && (pa.state === "error" || pa.health === "stalled");
    /* never heard a heartbeat: nothing good is claimed about this agent (whatever the pulse default says); a reported error still shows */
    if (isNaN(age) && !bad) status = "unknown";
    else if (!isNaN(age) && age > STALE_MS) status = "stale";
    else if (pa && pa.health === "stalled") status = "stalled";
    else if (pa && pa.paused) status = "paused";
    else if (pa && typeof pa.state === "string") status = pa.state;
    else status = "running";
    return { name: name, label: LABELS[name] || name, pa: pa, hbAge: age, status: status,
             hasPulse: !!pa, online: !isNaN(age) && age <= STALE_MS };
  }

  /* ---- FOMO links: from the API payload only, always with the disclosure ---- */
  var FALLBACK_NOTE = "Opens FOMO. The desk places no orders; you trade on FOMO yourself.";

  function safeFomoUrl(url, ref) {
    if (typeof url !== "string" || !ref || url.indexOf(ref) === -1) return "";
    var u;
    try { u = new URL(url); } catch (e) { return ""; }
    return u.protocol === "https:" ? url : "";
  }

  function noteEl(note) {
    var p = document.createElement("p");
    p.className = "link-note";
    p.textContent = typeof note === "string" && note ? note : FALLBACK_NOTE;
    return p;
  }

  /* Adds <li><span label/><a href=payload url>text</a><p caption/></li>. Returns the li or null. */
  function renderFomoLink(list, label, text, url, fomo) {
    var href = safeFomoUrl(url, fomo && fomo.link_ref);
    if (!href) return null;
    var li = document.createElement("li");
    var lab = document.createElement("span");
    lab.className = "row-label";
    lab.textContent = label;
    var a = document.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("data-link-kind", String(fomo.link_kind || ""));
    a.textContent = text;
    li.appendChild(lab);
    li.appendChild(a);
    li.appendChild(noteEl(fomo.link_note));
    list.appendChild(li);
    return li;
  }

  function inviteRow(list, fomo) {
    var href = safeFomoUrl(fomo.signup_url, fomo.link_ref);
    if (!href) return;
    var li = document.createElement("li");
    var lab = document.createElement("span");
    lab.className = "row-label";
    lab.textContent = "Invite a friend (referral link)";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-link-kind", String(fomo.link_kind || ""));
    btn.textContent = "Invite a friend";
    var status = document.createElement("p");
    status.className = "link-note";
    status.textContent = typeof fomo.link_note === "string" && fomo.link_note ? fomo.link_note : FALLBACK_NOTE;
    btn.addEventListener("click", function () {
      if (navigator.share) {
        navigator.share({ url: href }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(href).then(function () { status.textContent = "Link copied. " + (fomo.link_note || FALLBACK_NOTE); }).catch(function () {});
      }
    });
    li.appendChild(lab);
    li.appendChild(btn);
    li.appendChild(status);
    list.appendChild(li);
  }

  function showFomo(fomo) {
    var section = document.getElementById("fomo");
    var list = document.getElementById("fomo-links");
    if (!section || !list) return;
    if (!fomo || typeof fomo !== "object") { section.hidden = true; return; }
    list.replaceChildren();
    renderFomoLink(list, "Your FOMO profile", "Open profile on FOMO", fomo.profile_url, fomo);
    inviteRow(list, fomo);
    section.hidden = list.children.length === 0;
  }

  function setPairStatus(text, tone) {
    if (!pairBox) return;
    var status = pairBox.querySelector("#pair-status");
    if (status) {
      status.textContent = text;
      status.setAttribute("data-tone", tone || "info");
    }
  }

  function hidePairing() {
    if (pairBox && pairBox.parentNode) pairBox.parentNode.removeChild(pairBox);
    pairBox = null;
  }

  function showPairing(message) {
    pausePolling();
    hideStaleBanner();
    showFomo(null);
    setFlow(false);
    setMode("PAPER");
    UI.setLink("idle");
    showMessage(message || "Enter the pairing code shown on the desk.");
    var isError = !!message && message.indexOf("Enter the pairing code") !== 0;
    if (pairBox) {
      setPairStatus(message || "Enter the pairing code shown on the desk.", isError ? "error" : "info");
      go("pair");
      return;
    }
    var box = document.createElement("div");
    box.id = "pair-box";
    box.className = "pair-card glow-card";
    var label = document.createElement("label");
    label.setAttribute("for", "pair-code");
    label.textContent = "Pairing code";
    var input = document.createElement("input");
    input.id = "pair-code";
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "characters");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("inputmode", "text");
    input.setAttribute("maxlength", "12");
    input.setAttribute("placeholder", "••••••");
    var btn = document.createElement("button");
    btn.id = "pair-submit";
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Pair";
    var status = document.createElement("p");
    status.id = "pair-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("data-tone", isError ? "error" : "info");
    status.textContent = message || "Enter the pairing code shown on the desk.";
    btn.addEventListener("click", submitPair);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") submitPair();
    });
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btn);
    box.appendChild(status);
    var slot = document.getElementById("pair-slot") || document.querySelector("main") || document.body;
    slot.appendChild(box);
    pairBox = box;
    go("pair");
  }

  function submitPair() {
    if (!pairBox) return;
    var input = pairBox.querySelector("#pair-code");
    var code = input ? String(input.value || "") : "";
    var btn = pairBox.querySelector("#pair-submit");
    if (btn) btn.disabled = true;
    setPairStatus("Pairing…");
    if (btn) btn.classList.add("is-busy");
    fetch(API_BASE + "/api/pair/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, label: "iPhone" }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) {
      if (res.status === 429) { setPairStatus("Too many attempts. Try again later.", "error"); return null; }
      if (!res.ok) { setPairStatus("That code did not work. Check it and try again.", "error"); return null; }
      return res.json();
    }).then(function (data) {
      if (!data) return;
      var t = data && data.token;
      if (!t || !TOKEN_RE.test(t)) { setPairStatus("That code did not work. Check it and try again.", "error"); return; }
      store(function (s) { s.setItem(KEY, t); });
      if (input) input.value = "";
      hidePairing();
      backoffMs = 0;
      forgetSeen();           /* first launch after pairing: play the full start-up flow */
      setFlow(true);
      go("fomo");
    }).catch(function () {
      setPairStatus("Offline.", "error");
    }).then(function () {
      if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    });
  }

  function revokeSelf(t) {
    fetch(API_BASE + "/api/pair/revoke-self", {
      method: "POST",
      headers: { Authorization: "Bearer " + t },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).catch(function () {});
  }


  function revokeSelf(t) {
    fetch(API_BASE + "/api/pair/revoke-self", {
      method: "POST",
      headers: { Authorization: "Bearer " + t },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).catch(function () {});
  }

  function selectCoin(mint, from) {
    if (typeof mint !== "string" || !MINT_RE.test(mint)) return false;
    selMint = mint;
    selFrom = from || "dashboard";
    return true;
  }
  var selFrom = "dashboard";

  /* ---- alerts on this device (Settings). Saves a Web Push subscription with the Worker (POST /api/push, device token). Nothing is
     delivered until the owner also turns alerts.push_enabled on at the desk; this only registers the phone. ---- */
  function alertsSupport() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return { ok: false, text: "Web Push isn't available in this browser. On iPhone it needs iOS 16.4+ and the app added to the Home Screen." };
    }
    return { ok: true, permission: Notification.permission };
  }
  function b64urlToBytes(str) {
    var pad = "=".repeat((4 - (str.length % 4)) % 4);
    var raw = atob((str + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function enableAlerts() {
    var sup = alertsSupport();
    var t = token();
    if (!sup.ok) return Promise.resolve({ ok: false, text: sup.text });
    if (!t) return Promise.resolve({ ok: false, text: "Pair this iPhone first." });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") return { ok: false, text: "Notifications are blocked for this app. Allow them in iOS Settings, then try again." };
      return fetch("vapid-public-key.txt", { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (key) {
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key.trim()) });
        });
      }).then(function (sub) {
        return fetch(API_BASE + "/api/push", {
          method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
        });
      }).then(function (res) {
        if (res.status === 404) return { ok: false, text: "The Worker doesn't have the push route yet. Nothing was saved." };
        if (!res.ok) return { ok: false, text: "The desk link refused it (" + res.status + "). Nothing was saved." };
        return { ok: true, text: "This iPhone is registered. Alerts are delivered only once they are switched on at the desk." };
      });
    }).catch(function () { return { ok: false, text: "Couldn't register this iPhone for alerts. Nothing was saved." }; });
  }
  function cacheInfo() {
    if (!("caches" in window)) return Promise.resolve(null);
    return caches.keys().then(function (keys) { return keys.filter(function (k) { return /^x4rax-desk-/.test(k); }); }).catch(function () { return null; });
  }

  document.addEventListener("visibilitychange", function () {
    if (isVisible()) onWake();
    else onHidden();
  });
  window.addEventListener("pagehide", onHidden);
  window.addEventListener("freeze", onHidden);
  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) {
      stopTimer();
      onWake();
    }
  });
  window.addEventListener("focus", onWake);
  window.addEventListener("online", function () { backoffMs = 0; onWake(); });

  window.addEventListener("hashchange", onHashChange);
  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    var startup = t.closest("[data-startup]");
    if (startup) { startFlow(); return; }
    var fin = t.closest("[data-flow-end]");
    if (fin) { endFlow(fin.getAttribute("data-flow-end") || "dashboard"); return; }
    var b = t.closest("[data-go]");
    if (b) go(b.getAttribute("data-go"));
  });

  /* Screens register {enter, update, leave}; update(what) is called after every data change while their route is showing. */
  window.DeskApp = {
    D: function () { return D; }, M: function () { return M; }, X: X, XM: XM,
    register: function (route, h) { handlers[route] = h; },
    go: go, startFlow: startFlow, endFlow: endFlow, isFlow: function () { return flow; },
    ensure: ensure, select: selectCoin, selected: function () { return selMint; }, selectedFrom: function () { return selFrom; },
    agentView: agentView, kick: kick, route: function () { return currentRoute; },
    alertsSupport: alertsSupport, enableAlerts: enableAlerts, cacheInfo: cacheInfo, unpair: function () { location.hash = "logout"; },
    safeFomoUrl: safeFomoUrl, renderFomoLink: renderFomoLink, noteEl: noteEl,
    isDemo: function () { return !!(D.state && D.state.demo === true); },
    STALE_MS: STALE_MS, LABELS: LABELS, MINT_RE: MINT_RE, token: token
  };

  /* Called by boot.js after every screens file has registered. */
  window.DeskApp.boot = function () {
    var deepRoute = routeFromHash();
    var frag = readFragment();
    var skipSplash = frag === "route" && !!deepRoute && deepRoute !== "splash";
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    /* A cold start plays the splash first (screen changes wait for it). A direct #route link (previews) skips it. */
    if (!skipSplash) startSplash();
    if (frag === "logout" || !token()) {
      showPairing("Enter the pairing code shown on the desk.");
    } else {
      kick();
    }
    if (skipSplash) {
      if (token() && (deepRoute === "init" || ((deepRoute === "fomo" || deepRoute === "pipeline") && !seen()))) setFlow(true);
      go(deepRoute, "replace");
    }
  };
})();
