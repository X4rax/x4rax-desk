/* Main screens: #dashboard (Home), #positions, #scanner, #coin. Everything is drawn from the Worker payloads held by DeskApp:
   portfolio (SIMULATION: the PAPER ledger), market (MARKET DATA seen by Scanner/Auditor/Analyst), pulse (agent status + events),
   state, coin / audit / decisions. A missing payload shows an honest empty or "unavailable" state. Numbers the desk did not record
   are shown as "—". Win rate and drawdown carry an "insufficient data" label below the sample threshold the desk reports.
   Labels: MARKET DATA = real prices/liquidity from DexScreener etc.; SIMULATION = the PAPER ledger (no real orders ever);
   DEMO = synthetic fixtures (only ever seen in the local preview). DOM is built with textContent only. */
(function () {
  "use strict";
  var A = window.DeskApp, UI = window.DeskUI;
  var h = UI.h, add = UI.add, f = UI.fmt;
  var ORDER = ["main", "scanner", "auditor", "analyst", "executor", "risk"];
  var DECIDERS = ["scanner", "auditor", "analyst", "executor", "risk"];
  var STATE_TEXT = { scanning: "Scanning", analyzing: "Analyzing", processing: "Processing", idle: "Idle", waiting: "Waiting",
                     error: "Error", stale: "No heartbeat", stalled: "Stalled", paused: "Paused", unknown: "No data yet", running: "Online" };
  var RANGES = [["1H", 3600], ["6H", 21600], ["1D", 86400], ["ALL", 0]];
  var rangeSel = "ALL";
  var decSel = "scanner";
  var showAllEvents = false, showAllAlerts = false;
  var charts = {};

  function D() { return A.D(); }
  function M() { return A.M(); }
  function tags() {
    var wrap = h("span", "tags");
    for (var i = 0; i < arguments.length; i++) add(wrap, UI.srcTag(arguments[i]));
    if (A.isDemo()) add(wrap, UI.srcTag("demo"));
    return wrap;
  }
  function card(title, tagEl, cls) {
    var c = h("section", "card " + (cls || ""));
    add(c, add(h("div", "card-head"), h("h3", null, title), tagEl));
    return c;
  }
  function unavailableNote(text) { return UI.empty("chart", "Not available yet", text); }
  function toneOf(n) { return f.tone(n); }
  function sgnPct(n) { return f.pct(n, 1); }
  function box(id) { return document.getElementById(id); }
  function sigOf() { return JSON.stringify(Array.prototype.slice.call(arguments)); }
  function openCoin(mint, from) {
    if (A.select(mint, from)) A.go("coin");
  }
  function verdictTone(v) {
    v = String(v || "").toLowerCase();
    if (/kill|reject|stop|skip|fail/.test(v)) return "down";
    if (/pass|bought|clear|sold|trail|buy/.test(v)) return "up";
    return "flat";
  }
  function tile(label, value, sub, tn, weak) {
    var t = h("div", "tile" + (weak ? " is-weak" : ""));
    var v = h("strong", "tile-v tone-" + (tn || "flat"), value);
    add(t, h("span", "tile-k", label), v, sub ? h("span", "tile-sub", sub) : null);
    return t;
  }
  function kvList(pairs) {
    var dl = h("dl", "kv");
    pairs.forEach(function (p) { if (p[1] !== null && p[1] !== undefined && p[1] !== "") add(dl, h("dt", null, p[0]), h("dd", null, p[1])); });
    return dl;
  }
  function fomoBlock(url, meta) {
    var sec = h("section", "card fomo-external");
    add(sec, add(h("div", "card-head"), h("h3", null, "Open on FOMO"), h("span", "ext-tag", "external site")));
    var ul = h("ul", "ext-links");
    var li = A.renderFomoLink(ul, "FOMO coin page", "Open on FOMO", url, meta);
    if (!li) return null;
    add(sec, ul);
    return sec;
  }
  function eventText(ev) {
    var coin = ev.coin || "a coin", d = ev.detail ? " · " + ev.detail : "";
    switch (ev.kind) {
      case "scan_pass": return coin + " passed the Scanner" + d;
      case "scan_kill": return coin + " rejected by the Scanner" + d;
      case "audit_start": return "Auditing " + coin;
      case "audit_done": return "Audit finished for " + coin + d;
      case "analyze_start": return "Analyzing " + coin;
      case "verdict": return "Verdict on " + coin + d;
      case "signal": return "Signal for " + coin + d;
      case "position_open": return "Opened PAPER position in " + coin + d;
      case "exit": return "Closed " + coin + d;
      case "no_price": return "No price for " + coin;
      case "service_start": return "Desk started" + d;
      default: return String(ev.kind || "event").replace(/_/g, " ") + (ev.coin ? " · " + ev.coin : "") + d;
    }
  }

  /* ---------------------------------------------------------------- alerts (derived from real status and events) */
  function deriveAlerts() {
    var out = [], d = D(), now = Date.now();
    ORDER.forEach(function (n) {
      var av = A.agentView(n), label = A.LABELS[n];
      if (av.status === "error") out.push({ sev: "bad", agent: n, title: label + " reported an error", text: (av.pa && (av.pa.last_error || av.pa.task)) || "", t: av.pa && av.pa.last_error_at ? Date.parse(av.pa.last_error_at) : now, live: true });
      else if (av.status === "stalled") out.push({ sev: "bad", agent: n, title: label + " stopped responding", text: "The desk flagged this agent as stalled.", t: now, live: true });
      else if (av.status === "stale") out.push({ sev: "warn", agent: n, title: label + " has no fresh heartbeat", text: "Last heartbeat " + f.ago(av.hbAge) + ".", t: now - (isFinite(av.hbAge) ? av.hbAge : 0), live: true });
    });
    var hl = d.state && d.state.health;
    // only when a good sync was recorded earlier: the very first snapshot is always built before its own first push
    if (hl && hl.push_ok === false && hl.last_push_ok_at) out.push({ sev: "warn", agent: "main", title: "Desk to Worker sync is failing", text: "Last good sync " + f.agoIso(hl.last_push_ok_at) + ".", t: now, live: true });
    var evs = d.pulse && Array.isArray(d.pulse.events) ? d.pulse.events : [];
    evs.forEach(function (e) {
      var t = Date.parse(e.ts);
      if (!isFinite(t) || now - t > 24 * 3600 * 1000) return;
      var map = { error: ["bad", "Error"], agent_stalled: ["bad", "Agent stalled"], push_failing: ["warn", "Sync failing"], restart: ["warn", "Component restarted"],
                  no_price: ["warn", "No price available"], exit: ["info", "Risk exit"], dex_limited: ["warn", "DexScreener rate limit"] };
      var m = map[e.kind];
      if (!m) return;
      out.push({ sev: m[0], agent: e.agent, title: m[1] + (e.coin && e.kind !== "error" ? " · " + e.coin : ""), text: e.detail || "", t: t, mint: e.mint || null });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }

  /* ================================================================ #dashboard */
  var dash = null;
  function buildDash() {
    var body = box("dashboard-body");
    dash = {
      hero: h("div"), waiting: h("div"), equityWrap: h("section", "card equity-card"), perf: h("div"), alerts: h("div"), agents: h("div"),
      feed: h("div"), dec: h("div"), foot: h("div"), pos: h("div"), disc: h("div")
    };
    // equity chart shell (persistent so the canvas survives updates)
    var head = add(h("div", "card-head"), h("h3", null, "Equity curve"), tags("sim"));
    var tabs = h("div", "seg-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Equity range");
    RANGES.forEach(function (r) {
      var b = h("button", "seg-tab", r[0]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("data-range", r[0]);
      b.addEventListener("click", function () { rangeSel = r[0]; updateDash(); });
      tabs.appendChild(b);
    });
    var probe = h("p", "probe");
    probe.setAttribute("aria-live", "off");
    var canvas = h("canvas", "chart-canvas");
    canvas.setAttribute("role", "img");
    var cap = h("p", "chart-cap");
    add(dash.equityWrap, head, tabs, probe, canvas, cap);
    dash.eq = { tabs: tabs, probe: probe, canvas: canvas, cap: cap };
    var intro = h("div", "dash-links");
    var go = h("button", "btn btn-ghost");
    go.type = "button";
    go.setAttribute("data-startup", "1");
    go.textContent = "Show startup";
    add(dash.foot, go);
    add(body, dash.hero, dash.waiting, dash.equityWrap, dash.pos, dash.disc, dash.perf, dash.alerts, dash.agents, dash.dec, dash.feed, dash.foot);
    void intro;
  }

  function heroCard() {
    var P = D().portfolio, S = D().state, c = h("section", "glow-card hero");
    var head = add(h("div", "card-head"), h("p", "eyebrow", "PAPER portfolio"), tags("sim"));
    add(c, head);
    var bal = P ? P.balance : (S ? S.balance : null);
    add(c, h("p", "hero-balance", f.money(bal)));
    var start = P ? P.start_stack : (S ? S.start_value : null);
    var ret = P ? P.total_return_pct : (S && S.start_value ? (S.balance / S.start_value - 1) * 100 : null);
    add(c, h("p", "hero-sub", (start ? "Started with " + f.money(start) : "") + (f.num(ret) ? " · " + sgnPct(ret) + " since start" : "")));
    var row = h("div", "chips-row");
    function pill(label, val, n) { var p = h("div", "pnl-pill tone-" + toneOf(n)); add(p, h("span", "pnl-k", label), h("strong", null, val)); return p; }
    if (P) {
      add(row, pill("Total P&L", f.signed(P.total_pnl_usd), P.total_pnl_usd), pill("Realized", f.signed(P.realized_pnl_usd), P.realized_pnl_usd),
          pill("Unrealized", f.signed(P.unrealized_pnl_usd), P.unrealized_pnl_usd));
    } else if (S) {
      add(row, pill("Total P&L", f.num(S.balance) && f.num(S.start_value) ? f.signed(S.balance - S.start_value) : "—", S.balance - S.start_value));
    }
    if (S && f.num(S.today_pct)) add(row, pill("Today", sgnPct(S.today_pct), S.today_pct));
    add(c, row);
    if (P) add(c, h("p", "hero-note", "Free " + f.money(P.free) + " · " + P.counts.open + " open · " + P.counts.closed + " closed · fees paid " + f.money(P.fees_paid_closed_usd)));
    else if (S) add(c, h("p", "hero-note", "Detailed portfolio isn't available from the Worker yet; showing the balance the desk reports."));
    else add(c, UI.skeleton(2));
    return [c];
  }

  function moreLink(text, route) {
    var b = h("button", "btn-link", text);
    b.type = "button";
    b.addEventListener("click", function () { A.go(route); });
    return b;
  }

  // compact open positions on the dashboard (full list: Positions tab)
  function posGlanceCard() {
    var P = D().portfolio;
    if (!P || P.empty || !P.open.length) return [];
    var c = card("Open positions", tags("sim", "market"));
    P.open.slice(0, 3).forEach(function (p) {
      var b = h("button", "closed-row");
      b.type = "button";
      b.addEventListener("click", function () { openCoin(p.mint, "dashboard"); });
      add(b, add(h("div", "closed-l"), h("strong", null, p.name), h("span", "muted small", "entry " + f.price(p.entry_price) + (p.priced ? " · last " + f.price(p.last_price) : " · no price yet") + " · " + f.money(p.size_usd))),
        add(h("div", "closed-r tone-" + toneOf(p.pnl_usd)), h("strong", null, p.priced ? f.signed(p.pnl_usd) : "—"), h("span", null, p.priced ? sgnPct(p.pnl_pct) : "")));
      c.appendChild(b);
    });
    add(c, moreLink("All positions (" + P.counts.open + " open, " + P.counts.closed + " closed)", "positions"));
    return [c];
  }

  // latest scanner discoveries (full funnel: Scanner tab)
  function discGlanceCard() {
    var mk = D().market, items = mk && Array.isArray(mk.discoveries) ? mk.discoveries : [];
    if (!items.length) return [];
    var c = card("Latest discoveries", tags("market"));
    items.slice(0, 2).forEach(function (it) { c.appendChild(discoveryCard(it)); });
    add(c, moreLink("Open the Scanner", "scanner"));
    return [c];
  }

  function waitingCard() {
    var P = D().portfolio;
    if (!P || !P.empty) return [];
    var mk = D().market, fn = mk && mk.funnel;
    var c = h("section", "card waiting");
    add(c, add(h("div", "card-head"), h("h3", null, "Waiting for the first simulated trade"), tags("sim")));
    var wrap = h("div", "waiting-body");
    var orb = h("span", "waiting-orb");
    orb.appendChild(UI.icon("scanner", "icon"));
    var txt = h("div");
    add(txt, h("p", "empty-text", P.empty_text || "No simulated trades yet."));
    if (fn) {
      add(txt, h("p", "empty-text", "Tonight so far: " + fn.graduations + " graduations seen, " + fn.scanner_decided + " judged by the Scanner, " + fn.scanner_passed + " passed" +
        (fn.audit_cleared ? ", " + fn.audit_cleared + " cleared the Auditor" : "") + ". Filters are strict on purpose; a quiet desk is a working desk."));
    }
    add(wrap, orb, txt);
    return [add(c, wrap)];
  }

  function visiblePoints(P) {
    var pts = P && P.equity && Array.isArray(P.equity.points) ? P.equity.points : [];
    var r = RANGES.filter(function (x) { return x[0] === rangeSel; })[0], win = r ? r[1] : 0;
    if (!pts.length) return pts;
    if (!win) return pts;
    var last = pts[pts.length - 1].t, out = pts.filter(function (p) { return p.t >= last - win; });
    return out.length >= 2 ? out : pts;
  }

  function drawEquity() {
    var P = D().portfolio, eq = dash.eq, pts = visiblePoints(P);
    Array.prototype.forEach.call(eq.tabs.children, function (b) {
      var on = b.getAttribute("data-range") === rangeSel;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    dash.equityWrap.hidden = !P;
    if (!P) return;
    var sig = JSON.stringify([pts.length, pts.length ? pts[0].t : 0, pts.length ? pts[pts.length - 1].t : 0, pts.length ? pts[pts.length - 1].v : 0, rangeSel, P.equity.start_value]);
    var first = pts[0], last = pts[pts.length - 1];
    function readout(p) {
      if (!p) { eq.probe.textContent = last ? "Now " + f.money(last.v) + (first && first !== last ? " · " + f.signed(last.v - first.v) + " over " + (rangeSel === "ALL" ? "all history" : rangeSel) : "") : "No equity history yet";
        return; }
      eq.probe.textContent = new Date(p.t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " · " + f.money(p.v);
    }
    eq.canvas.setAttribute("aria-label", pts.length ? "Equity curve, " + f.money(first.v) + " to " + f.money(last.v) : "No equity data");
    if (eq.sig !== sig) {
      eq.sig = sig;
      charts.equity = window.DeskCharts.equity(eq.canvas, pts, {
        base: P.equity.start_value, fmtY: function (v) { return "$" + v.toFixed(v >= 1000 ? 0 : 1); },
        fmtX: function (t) { return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); },
        onProbe: readout
      });
    }
    readout(null);
    var flat = pts.length > 1 && pts.every(function (p) { return p.v === pts[0].v; });
    eq.cap.textContent = (P.empty ? "No simulated trades yet, so the line is flat. " : flat ? "Balance unchanged over this range. " : "") + "Mark-to-market PAPER balance (SIMULATION); dashed line = starting stack.";
  }

  function perfCard() {
    var P = D().portfolio;
    if (!P) return [];
    var c = card("Performance", tags("sim"));
    var smp = P.sample || {}, weak = !smp.meaningful, n = P.counts.closed;
    var flagTxt = n === 0 ? "No closed trades yet" : "INSUFFICIENT DATA · " + n + " of " + smp.min_for_stats + " closed trades";
    if (weak) add(c, h("p", "insuff", flagTxt));
    var grid = h("div", "tiles");
    var ci = P.win_rate_ci95 ? "95% range " + Math.round(P.win_rate_ci95[0] * 100) + "–" + Math.round(P.win_rate_ci95[1] * 100) + "%" : null;
    add(grid,
      tile("Win rate", f.num(P.win_rate) ? Math.round(P.win_rate * 100) + "%" : "—", ci, "flat", weak && n > 0),
      tile("Max drawdown", f.num(P.max_drawdown_pct) && P.equity && P.equity.points.length > 1 && n > 0 ? "-" + P.max_drawdown_pct.toFixed(1) + "%" : "—", f.num(P.max_drawdown_usd) && n > 0 ? "-" + f.money(P.max_drawdown_usd) : null, "down", weak && n > 0),
      tile("Profit factor", f.num(P.profit_factor) ? P.profit_factor.toFixed(2) : "—", null, "flat", weak && n > 0),
      tile("Closed trades", String(n), P.counts.wins + " won · " + P.counts.losses + " lost", "flat"),
      tile("Avg win", f.num(P.avg_win_usd) ? f.signed(P.avg_win_usd) : "—", null, "up"),
      tile("Avg loss", f.num(P.avg_loss_usd) ? f.signed(P.avg_loss_usd) : "—", null, "down"));
    add(c, grid);
    var ex = P.execution || {};
    add(c, h("p", "muted small", (smp.note || "") + (ex.slippage_modeled === false ? " Slippage is not modelled: fills use the polled price, so simulated P&L is optimistic." : "")));
    return [c];
  }

  function alertsCard() {
    var list = deriveAlerts();
    var c = card("Alerts", list.length ? UI.chip(list.length + (list.length === 1 ? " item" : " items"), list.some(function (a) { return a.sev === "bad"; }) ? "bad" : "warn") : D().pulse ? UI.chip("All clear", "up") : UI.chip("Unavailable", "flat"));
    c.id = "alerts-card";
    if (!list.length) {
      add(c, D().pulse ? UI.empty("check", "All clear", "No agent errors, missing heartbeats or sync problems right now.") : UI.empty("chart", "Not available yet", "Alerts use the live agent status, which needs the upgraded Worker. Nothing is guessed in its place."));
      return [c];
    }
    var ul = h("ul", "alert-list");
    list.slice(0, showAllAlerts ? 30 : 4).forEach(function (a) {
      var li = h("li", "alert-item alert-" + a.sev);
      add(li, UI.agentBadge(a.agent, "sm", a.sev === "bad" ? "error" : "idle"), add(h("div", "alert-txt"), h("strong", null, a.title), a.text ? h("span", null, a.text) : null),
          h("span", "alert-time", a.live ? "now" : f.ago(Date.now() - a.t)));
      ul.appendChild(li);
    });
    add(c, ul);
    if (list.length > 4) {
      var more = h("button", "btn-link", showAllAlerts ? "Show fewer" : "Show all " + list.length);
      more.type = "button";
      more.addEventListener("click", function () { showAllAlerts = !showAllAlerts; dash.alerts.__sig = null; updateDash(); });
      add(c, more);
    }
    return [c];
  }

  function agentsCard() {
    var c = card("Agents", tags("desk"));
    var row = h("div", "agent-strip");
    var online = 0;
    ORDER.forEach(function (n, i) {
      var av = A.agentView(n);
      if (av.online && av.status !== "error" && av.status !== "stalled") online++;
      var b = h("button", "strip-item");
      b.type = "button";
      b.setAttribute("data-go", "pipeline");
      b.setAttribute("aria-label", av.label + ": " + (STATE_TEXT[av.status] || av.status));
      add(b, UI.agentBadge(n, "md", av.status), h("span", "strip-name", av.label), h("span", "strip-state", STATE_TEXT[av.status] || av.status));
      row.appendChild(b);
      void i;
    });
    add(c, row, h("p", "muted small", online + " of 6 online" + (D().pulse ? "" : " (heartbeats only: detailed status needs the desk upgrade)")));
    return [c];
  }

  function feedCard() {
    var P = D().pulse, c = card("Live activity", tags("desk"));
    var m = M().pulse || {};
    if (!P) {
      add(c, m.unavailable ? UI.empty("bell", "Live feed not available yet", "The activity feed needs the upgraded Worker. Nothing is shown in its place.") : UI.skeleton(4));
      return [c];
    }
    var evs = Array.isArray(P.events) ? P.events : [];
    if (m.at) add(c, h("p", "muted small live-line", "Updated " + f.ago(Date.now() - m.at) + " · 5 s refresh while this screen is open"));
    if (!evs.length) {
      add(c, UI.empty("bell", "Nothing has happened yet", "Agents only write an event when something real occurs: a coin scanned, audited, bought or sold. A quiet feed means a quiet market."));
      return [c];
    }
    var ul = h("ul", "feed");
    evs.slice(0, showAllEvents ? 40 : 8).forEach(function (e) {
      var li = h("li", "feed-item");
      li.setAttribute("data-agent", e.agent);
      var inner = e.mint ? h("button", "feed-btn") : h("div", "feed-btn");
      if (e.mint) { inner.type = "button"; inner.addEventListener("click", function () { openCoin(e.mint, "dashboard"); }); }
      add(inner, UI.agentBadge(e.agent, "sm", "idle"), add(h("div", "feed-txt"), h("span", "feed-agent", A.LABELS[e.agent] || e.agent), h("span", "feed-text", eventText(e))), h("span", "feed-time", f.agoIso(e.ts)));
      li.appendChild(inner);
      ul.appendChild(li);
    });
    add(c, ul);
    if (evs.length > 8) {
      var more = h("button", "btn-link", showAllEvents ? "Show fewer" : "Show all " + evs.length);
      more.type = "button";
      more.addEventListener("click", function () { showAllEvents = !showAllEvents; dash.feed.__sig = null; updateDash(); });
      add(c, more);
    }
    return [c];
  }

  function decisionsCard() {
    var c = card("Decisions by agent", tags("desk"));
    var tabs = h("div", "seg-tabs");
    tabs.setAttribute("role", "tablist");
    DECIDERS.forEach(function (n) {
      var b = h("button", "seg-tab" + (decSel === n ? " is-active" : ""), A.LABELS[n]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", decSel === n ? "true" : "false");
      b.setAttribute("data-agent", n);
      b.addEventListener("click", function () { decSel = n; dash.dec.__sig = null; A.ensure("decisions", n, "/api/agents/" + n + "/decisions", 30000); updateDash(); });
      tabs.appendChild(b);
    });
    add(c, tabs);
    var dec = A.X.decisions[decSel], dm = A.XM["decisions:" + decSel] || {};
    if (dec && Array.isArray(dec.decisions) && dec.decisions.length) {
      var ul = h("ul", "dec-list");
      dec.decisions.slice(0, 6).forEach(function (d) {
        var li = h("li", "dec-item");
        var b = d.mint ? h("button", "dec-btn") : h("div", "dec-btn");
        if (d.mint) { b.type = "button"; b.addEventListener("click", function () { openCoin(d.mint, "dashboard"); }); }
        add(b, UI.chip(d.verdict || "—", verdictTone(d.verdict)), add(h("div", "dec-txt"), h("strong", null, d.coin || "coin"), d.reason ? h("span", null, d.reason) : null), h("span", "feed-time", f.agoIso(d.ts)));
        li.appendChild(b);
        ul.appendChild(li);
      });
      add(c, ul);
    } else if (dm.unavailable) add(c, UI.empty("check", "Not available yet", "Decision history needs the upgraded Worker."));
    else if (dm.at) add(c, UI.empty("check", "No decisions yet", A.LABELS[decSel] + " has not recorded a decision. It only logs real ones."));
    else add(c, UI.skeleton(3));
    return [c];
  }

  function updateDash() {
    if (!dash) buildDash();
    var d = D(), P = d.portfolio, S = d.state, pu = d.pulse, mk = d.market;
    var minute = Math.floor(Date.now() / 5000);
    UI.memo(dash.hero, sigOf(P && [P.balance, P.total_pnl_usd, P.realized_pnl_usd, P.unrealized_pnl_usd, P.free, P.counts, P.fees_paid_closed_usd], S && [S.balance, S.today_pct], A.isDemo()), heroCard);
    UI.memo(dash.waiting, sigOf(P && P.empty, mk && mk.funnel, A.isDemo()), waitingCard);
    drawEquity();
    UI.memo(dash.pos, sigOf(P && [P.open, P.counts, P.empty], mk && mk.discoveries && mk.discoveries.length, A.isDemo()), posGlanceCard);
    UI.memo(dash.disc, sigOf(mk && mk.discoveries && mk.discoveries.slice(0, 2), A.isDemo()), discGlanceCard);
    UI.memo(dash.perf, sigOf(P && [P.win_rate, P.win_rate_ci95, P.max_drawdown_pct, P.profit_factor, P.counts, P.sample, P.avg_win_usd, P.avg_loss_usd], A.isDemo()), perfCard);
    var al = deriveAlerts();
    UI.memo(dash.alerts, sigOf(al.map(function (a) { return [a.title, a.text, a.sev, a.live ? 0 : Math.floor((Date.now() - a.t) / 60000)]; }), showAllAlerts, !!pu), alertsCard);
    UI.memo(dash.agents, sigOf(ORDER.map(function (n) { return A.agentView(n).status; }), !!pu), agentsCard);
    UI.memo(dash.feed, sigOf(pu && pu.seq, showAllEvents, (M().pulse || {}).unavailable, minute), feedCard);
    var dec = A.X.decisions[decSel];
    UI.memo(dash.dec, sigOf(decSel, dec && dec.decisions && dec.decisions.length && dec.decisions[0].ts, (A.XM["decisions:" + decSel] || {}).at), decisionsCard);
  }

  A.register("dashboard", {
    enter: function () { updateDash(); A.ensure("decisions", decSel, "/api/agents/" + decSel + "/decisions", 30000); },
    update: updateDash
  });

  /* ================================================================ #positions */
  var posBox = box("positions-body");

  function marketInfo(mint) {
    var mk = D().market, items = mk && Array.isArray(mk.discoveries) ? mk.discoveries : [];
    for (var i = 0; i < items.length; i++) if (items[i].mint === mint) return items[i];
    return null;
  }

  function fillFunnelNote(c) {
    var fn = D().market && D().market.funnel;
    if (fn) add(c, h("p", "muted small", "Tonight: " + fn.graduations + " graduations · " + fn.scanner_passed + " passed the Scanner · " + fn.audit_cleared + " cleared the Auditor · " + fn.bought + " bought."));
  }

  function positionsBody() {
    var P = D().portfolio, out = [];
    if (!P) {
      out.push((M().portfolio || {}).unavailable ? card("Positions", tags("sim")) : card("Positions", tags("sim")));
      add(out[0], (M().portfolio || {}).unavailable ? UI.empty("positions", "Not available yet", "Positions need the upgraded Worker. Nothing is estimated in its place.") : UI.skeleton(4));
      return out;
    }
    // summary
    var expo = P.open.reduce(function (s, p) { return s + (p.size_usd || 0); }, 0);
    var sum = h("section", "glow-card pos-summary");
    add(sum, add(h("div", "card-head"), h("p", "eyebrow", "Simulated positions"), tags("sim")));
    var row = h("div", "tiles");
    add(row, tile("Open", String(P.counts.open), expo ? f.money(expo) + " simulated exposure" : null, "flat"),
        tile("Unrealized", f.signed(P.unrealized_pnl_usd), "gross, before exit fees", toneOf(P.unrealized_pnl_usd)),
        tile("Realized", f.signed(P.realized_pnl_usd), P.counts.closed + " closed", toneOf(P.realized_pnl_usd)));
    add(sum, row);
    out.push(sum);
    if (P.empty) {
      var e = h("section", "card waiting");
      add(e, add(h("div", "card-head"), h("h3", null, "No simulated trades yet"), tags("sim")));
      var w = h("div", "waiting-body"), orb = h("span", "waiting-orb");
      orb.appendChild(UI.icon("positions", "icon"));
      var t = h("div");
      add(t, h("p", "empty-text", P.empty_text || "No simulated trades yet."), h("p", "empty-text", "When the desk simulates a BUY, the position appears here with its entry, stop, trailing exit and live P&L."));
      fillFunnelNote(t);
      add(w, orb, t);
      out.push(add(e, w));
      return out;
    }
    // open
    var oc = card("Open positions", tags("sim", "market"));
    if (!P.open.length) add(oc, h("p", "muted", "No open positions."));
    P.open.forEach(function (p) {
      var info = marketInfo(p.mint), mk = info && info.market;
      var b = h("button", "pos-card");
      b.type = "button";
      b.addEventListener("click", function () { openCoin(p.mint, "positions"); });
      var top = add(h("div", "pos-top"), add(h("div", "pos-name"), h("strong", null, p.name), p.symbol ? h("span", null, p.symbol) : null),
        h("strong", "pos-pnl tone-" + toneOf(p.pnl_usd), p.priced ? f.signed(p.pnl_usd) + " (" + sgnPct(p.pnl_pct) + ")" : "no price yet"));
      var g = h("div", "pos-grid");
      add(g, kvCell("Entry", f.price(p.entry_price)), kvCell("Last", p.priced ? f.price(p.last_price) : "—"), kvCell("Size", f.money(p.size_usd)),
          kvCell("Stop", f.price(p.stop_price)), kvCell("Liquidity", mk ? f.compact(mk.liquidity_usd) : "—"), kvCell("Mkt cap", mk ? f.compact(mk.market_cap) : "—"));
      var foot = add(h("div", "pos-foot"), p.trail_active ? UI.chip("trailing stop armed", "info") : UI.chip("fixed stop", "flat"), h("span", "muted small", "opened " + f.agoIso(p.opened_at) + (p.last_price_at ? " · priced " + f.agoIso(p.last_price_at) : "")));
      add(b, top, g, foot);
      oc.appendChild(b);
    });
    out.push(oc);
    // closed
    var cc = card("Closed positions", tags("sim"));
    if (!P.closed.length) add(cc, h("p", "muted", "Nothing closed yet."));
    P.closed.forEach(function (p) {
      var b = h("button", "closed-row");
      b.type = "button";
      b.addEventListener("click", function () { openCoin(p.mint, "positions"); });
      var dur = p.opened_at && p.closed_at ? Math.round((Date.parse(p.closed_at) - Date.parse(p.opened_at)) / 60000) : null;
      add(b, add(h("div", "closed-l"), h("strong", null, p.name), h("span", "muted small", (p.exit_reason || "closed") + (dur !== null ? " · held " + dur + "m" : "") + " · fees " + f.money(p.fees_usd))),
        add(h("div", "closed-r tone-" + toneOf(p.pnl_usd)), h("strong", null, f.signed(p.pnl_usd)), h("span", null, sgnPct(p.pnl_pct))));
      cc.appendChild(b);
    });
    out.push(cc);
    // history
    var hc = card("BUY / SELL simulation history", tags("sim"));
    var ul = h("ul", "hist");
    P.history.forEach(function (x) {
      var li = h("li", "hist-item");
      add(li, UI.chip(x.side, x.side === "BUY" ? "info" : (x.pnl_usd > 0 ? "up" : "down")),
        add(h("div", "hist-txt"), h("strong", null, x.name), h("span", null, f.price(x.price) + " · " + f.money(x.size_usd) + (x.reason ? " · " + x.reason : "") + (x.side === "SELL" && f.num(x.pnl_usd) ? " · " + f.signed(x.pnl_usd) : ""))),
        h("span", "feed-time", f.agoIso(x.ts)));
      ul.appendChild(li);
    });
    add(hc, ul);
    if (!P.history.length) add(hc, h("p", "muted", "No simulated orders yet."));
    out.push(hc);
    return out;
  }
  function kvCell(k, v) { var c = h("div", "kvc"); add(c, h("span", null, k), h("strong", null, v)); return c; }

  A.register("positions", {
    enter: function () { updatePositions(); },
    update: updatePositions
  });
  function updatePositions() {
    var P = D().portfolio, mk = D().market;
    UI.memo(posBox, sigOf(P && [P.counts, P.open, P.closed, P.history, P.unrealized_pnl_usd], mk && mk.discoveries && mk.discoveries.length, (M().portfolio || {}).unavailable, A.isDemo(), Math.floor(Date.now() / 30000)), positionsBody);
  }

  /* ================================================================ #scanner */
  var scanBox = box("scanner-body");

  function funnelCard(mk) {
    var fn = mk.funnel, c = card("Tonight's funnel", tags("market"));
    var steps = [["Graduations seen", fn.graduations], ["Judged by the Scanner", fn.scanner_decided], ["Passed the Scanner", fn.scanner_passed], ["Taken apart by the Auditor", fn.audited],
                 ["Cleared all 8 checks", fn.audit_cleared], ["Scored by the Analyst", fn.analyst_scored], ["Approved by the Analyst", fn.analyst_passed], ["Bought (PAPER)", fn.bought]];
    var max = Math.max.apply(null, steps.map(function (s) { return s[1] || 0; })) || 1;
    var ul = h("ul", "funnel");
    steps.forEach(function (s, i) {
      var li = h("li", "funnel-row");
      add(li, h("span", "funnel-k", s[0]), h("strong", "funnel-v", String(s[1] === null || s[1] === undefined ? "—" : s[1])), UI.bar(((s[1] || 0) / max) * 100, i < 3 ? "scanner" : i < 5 ? "auditor" : i < 7 ? "analyst" : "executor"));
      ul.appendChild(li);
    });
    add(c, ul);
    if (f.num(fn.scanner_pass_rate)) add(c, h("p", "muted", fn.scanner_passed + " of " + fn.scanner_decided + " coins (" + (fn.scanner_pass_rate * 100).toFixed(1) + "%) passed the Scanner since " + f.clock(mk.since) + ". The filters are strict by design, so a low pass rate is expected."));
    return c;
  }

  function discoveryCard(it) {
    var b = h("button", "disc-card");
    b.type = "button";
    b.addEventListener("click", function () { openCoin(it.mint, "scanner"); });
    var top = add(h("div", "disc-top"), add(h("div", "pos-name"), h("strong", null, it.name), it.symbol ? h("span", null, it.symbol) : null),
      UI.chip(it.verdict === "passed" ? "PASSED" : "KILLED", it.verdict === "passed" ? "up" : "down"));
    var mk = it.market || {};
    var g = h("div", "pos-grid");
    add(g, kvCell("Price", mk.price ? f.price(mk.price) : "—"), kvCell("Liquidity", f.compact(mk.liquidity_usd !== null && mk.liquidity_usd !== undefined ? mk.liquidity_usd : it.scan && it.scan.liquidity_usd)),
        kvCell("Mkt cap", f.compact(mk.market_cap)), kvCell("24h vol", f.compact(mk.volume_h24)), kvCell("Top 10", it.scan && f.num(it.scan.top10_pct) ? it.scan.top10_pct + "%" : "—"), kvCell("1h", it.scan && f.num(it.scan.h1_change_pct) ? sgnPct(it.scan.h1_change_pct) : "—"));
    var foot = h("div", "disc-foot");
    if (it.reason) add(foot, h("span", "disc-reason", it.reason));
    if (it.audit && it.audit.state !== "none") {
      add(foot, UI.chip("Audit " + it.audit.passed + "/" + it.audit.total + (it.audit.failed_layer ? " ✗ " + it.audit.failed_layer : it.audit.state === "cleared" ? " ✓" : ""), it.audit.state === "rejected" ? "down" : it.audit.state === "cleared" ? "up" : "info"));
    }
    if (it.analyst) add(foot, UI.chip("Analyst " + (f.num(it.analyst.score) ? it.analyst.score : "—") + (it.analyst.passed ? " ✓" : " ✗"), it.analyst.passed ? "up" : "down"));
    if (it.outcome) add(foot, UI.chip(it.outcome.status, verdictTone(it.outcome.status)));
    add(foot, h("span", "feed-time", f.agoIso(it.ts)));
    add(b, top, g, foot);
    return b;
  }

  function scannerBody() {
    var mk = D().market, out = [];
    if (!mk) {
      var c = card("Scanner", tags("market"));
      add(c, (M().market || {}).unavailable ? UI.empty("scanner", "Not available yet", "Scanner discoveries need the upgraded Worker. Nothing is shown in their place.") : UI.skeleton(5));
      return [c];
    }
    out.push(funnelCard(mk));
    if (Array.isArray(mk.kill_reasons) && mk.kill_reasons.length) {
      var kc = card("Why coins were rejected", tags("market"));
      var tot = mk.kill_reasons.reduce(function (s, k) { return s + k.n; }, 0) || 1;
      var ul = h("ul", "funnel");
      mk.kill_reasons.forEach(function (k) {
        var li = h("li", "funnel-row");
        add(li, h("span", "funnel-k", k.reason), h("strong", "funnel-v", k.n + " · " + Math.round((k.n / tot) * 100) + "%"), UI.bar((k.n / tot) * 100, "risk"));
        ul.appendChild(li);
      });
      add(kc, ul);
      out.push(kc);
    }
    var dc = card("Discoveries", tags("market"));
    add(dc, h("p", "muted small", "Prices, liquidity and market caps come from DexScreener via the Scanner. Audit results are the Auditor's 8 checks. Open a coin for the Scanner's safety and opportunity scores, which explain a verdict and never decide one."));
    if (mk.empty || !mk.discoveries.length) add(dc, UI.empty("scanner", "Nothing judged yet", mk.empty_text || "The Scanner is listening for new graduations."));
    else mk.discoveries.forEach(function (it) { dc.appendChild(discoveryCard(it)); });
    out.push(dc);
    return out;
  }
  A.register("scanner", { enter: updateScanner, update: updateScanner });
  function updateScanner() {
    var mk = D().market;
    UI.memo(scanBox, sigOf(mk && [mk.funnel, mk.kill_reasons, mk.discoveries], (M().market || {}).unavailable, A.isDemo(), Math.floor(Date.now() / 30000)), scannerBody);
  }

  /* ================================================================ #coin */
  function scoreChip(label, v) {
    return v === null || v === undefined ? UI.chip(label + " —", "flat") : UI.chip(label + " " + v, v >= 70 ? "up" : v >= 40 ? "warn" : "down");
  }
  function scannerDecisionCard(sd, rf) {
    var c = card("Scanner decision", tags("market"));
    var sc = sd.scores || {};
    add(c, add(h("div", "tok-name"), UI.chip(sd.verdict === "pass" ? "PASSED" : sd.verdict === "kill" ? "REJECTED" : "WATCHING", sd.verdict === "pass" ? "up" : sd.verdict === "kill" ? "down" : "info"),
      scoreChip("Safety", sc.safety), scoreChip("Opportunity", sc.opportunity)));
    if (sc.why) add(c, h("p", "muted", sc.why));
    if (sc.gates && sc.gates.length) {
      add(c, h("h4", "sub", "Mandatory gates"));
      var gl = h("ul", "gates");
      sc.gates.forEach(function (g) {
        add(gl, add(h("li", "gate gate-" + (g[1] === true ? "pass" : g[1] === false ? "fail" : "na")), h("span", null, g[0]), h("span", null, g[2] + " (needs " + g[3] + ")"),
          h("strong", null, g[1] === true ? "pass" : g[1] === false ? "FAIL" : "not measured")));
      });
      add(c, gl);
    }
    function parts(title, rows, cov) {
      add(c, h("h4", "sub", title));
      if (!rows || !rows.length) { add(c, h("p", "muted small", "No score: only " + Math.round((cov || 0) * 100) + "% of the formula could be measured for this coin.")); return; }
      var ul = h("ul", "mini-list");
      rows.forEach(function (r) { add(ul, add(h("li"), h("span", null, r[0] + " · " + r[3]), h("strong", null, r[1] === null ? "unavailable" : r[1] + " / " + r[2]))); });
      add(c, ul);
    }
    parts("Safety score parts", sc.safety_parts, sc.safety_coverage);
    if (sc.unavailable && sc.unavailable.length) add(c, h("p", "muted small", "Not measured: " + sc.unavailable.join(", ") + "."));
    parts("Opportunity score parts", sc.opportunity_parts, sc.opportunity_coverage);
    (sc.flags || []).forEach(function (x) { add(c, h("p", "flag-line", "⚠ " + x)); });
    var rows2 = [["Wait cause", sd.wait_cause ? String(sd.wait_cause).replace(/_/g, " ") : null], ["Polls before the verdict", sd.polls], ["First / peak liquidity", f.num(sd.first_liq_usd) ? f.compact(sd.first_liq_usd) + " / " + f.compact(sd.max_liq_usd) : null],
      ["Pool age at the verdict", f.num(sd.age_min) ? sd.age_min + " min" : null], ["1h volume", f.num(sd.volume_h1) ? f.compact(sd.volume_h1) : null]];
    if (rf) {
      rows2 = rows2.concat([["Holders", rf.total_holders], ["Largest real holder", f.num(rf.top1_pct) ? rf.top1_pct + "%" + (rf.top1_insider ? " (flagged insider)" : "") : null],
        ["Insider-held share", f.num(rf.insider_net_pct) ? rf.insider_net_pct + "% in " + rf.insider_holders + " wallets" : null], ["LP locked", f.num(rf.lp_locked_pct) ? rf.lp_locked_pct + "%" : null],
        ["Mint / freeze authority", rf.mint_revoked === null || rf.mint_revoked === undefined ? null : (rf.mint_revoked ? "mint revoked" : "mint LIVE") + " · " + (rf.freeze_revoked ? "freeze revoked" : "freeze LIVE")],
        ["Token extensions", rf.ext_flags && rf.ext_flags.length ? rf.ext_flags.join(", ") : (rf.token_program ? "none risky" : null)]]);
    }
    add(c, kvList(rows2));
    add(c, h("p", "muted small", rf ? "Holder facts come from Solana RPC and RugCheck. They are informational and never pass or reject a coin." : "No dev-wallet or bundle data was recorded for this coin (the Auditor never reached it, or the sources had no answer)."));
    return c;
  }


  var coinBox = box("coin-body");
  var coinSel = "";
  var coinRefs = null;

  function findPosition(mint) {
    var P = D().portfolio;
    if (!P) return null;
    var o = P.open.filter(function (p) { return p.mint === mint; })[0];
    if (o) return { open: true, p: o };
    var c = P.closed.filter(function (p) { return p.mint === mint; })[0];
    return c ? { open: false, p: c } : null;
  }

  function coinBody(mint) {
    var cn = A.X.coin[mint], au = A.X.audit[mint], it = marketInfo(mint), pos = findPosition(mint), cm = A.XM["coin:" + mint] || {};
    var out = [];
    var name = (cn && cn.name) || (it && it.name) || (pos && pos.p.name) || "Coin";
    var sym = (cn && cn.symbol) || (it && it.symbol) || (pos && pos.p.symbol) || "";
    var px = cn && f.num(cn.price) ? cn.price : it && it.market && it.market.price ? it.market.price : pos && pos.open && pos.p.priced ? pos.p.last_price : null;
    var hdr = h("section", "glow-card coin-hero");
    add(hdr, add(h("div", "card-head"), h("p", "eyebrow", (sym ? sym + " · " : "") + "Solana"), tags("market")));
    add(hdr, h("p", "hero-balance", px !== null ? f.price(px) : "—"));
    var sub = [];
    if (cn && f.num(cn.since_entry_pct)) sub.push(sgnPct(cn.since_entry_pct) + " since the simulated entry");
    if (it) sub.push(it.verdict === "passed" ? "Passed the Scanner" : "Rejected by the Scanner" + (it.reason ? ": " + it.reason : ""));
    if (cn && cn.stats && cn.stats.updated_at) sub.push("market data " + f.agoIso(cn.stats.updated_at));
    else if (it && it.market && it.market.updated_at) sub.push("market data " + f.agoIso(it.market.updated_at));
    add(hdr, h("p", "hero-sub", sub.join(" · ")));
    out.push(hdr);

    // chart
    var cc = card("Price chart", tags("market"));
    var hasCandles = cn && Array.isArray(cn.candles) && cn.candles.length >= 2;
    if (hasCandles) {
      var probe = h("p", "probe", "Touch and drag on the chart for open, high, low, close");
      var canvas = h("canvas", "chart-canvas chart-tall");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Candlestick chart, " + cn.candles.length + " candles of " + (cn.candle_s || 60) + " seconds");
      add(cc, probe, canvas);
      var lines = [];
      var ent = cn.entry_price || (pos && pos.p.entry_price);
      if (ent) lines.push({ price: ent, color: "#0a84ff", label: "entry (simulated)" });
      if (cn.exit && cn.exit.stop_price) lines.push({ price: cn.exit.stop_price, color: "#ff4d6d", label: "stop" });
      if (cn.exit && cn.exit.trail_active && cn.exit.trail_price) lines.push({ price: cn.exit.trail_price, color: "#ffd60a", label: "trail" });
      coinRefs = { canvas: canvas, probe: probe, cn: cn, lines: lines };
      add(cc, h("p", "chart-cap", "Candles of " + (cn.candle_s || 60) + " s from the desk's own price log (DexScreener). Dashed lines are the simulated entry and exits."));
    } else {
      coinRefs = null;
      add(cc, cm.unavailable ? UI.empty("chart", "No chart for this coin", "The Worker keeps price charts for the most recent and active coins only, or has not been upgraded yet.") : cm.at ? UI.empty("chart", "No candles recorded", "The desk has not logged enough prices for this coin to draw a chart.") : UI.skeleton(4));
    }
    out.push(cc);

    // stats
    var st = (cn && cn.stats) || {}, mk = (it && it.market) || {};
    var sc = card("Market data", tags("market"));
    var tiles = h("div", "tiles");
    add(tiles, tile("Liquidity", f.compact(st.liquidity_usd !== undefined ? st.liquidity_usd : mk.liquidity_usd), null, "flat"), tile("Market cap", f.compact(st.market_cap !== undefined ? st.market_cap : mk.market_cap), null, "flat"),
        tile("24h volume", f.compact(st.volume_h24 !== undefined ? st.volume_h24 : mk.volume_h24), null, "flat"), tile("Holders", st.holders ? String(st.holders) : "—", null, "flat"),
        tile("Age", (cn && cn.age_text) || (it && it.scan && f.num(it.scan.age_min) ? Math.round(it.scan.age_min) + "m old" : "—"), null, "flat"),
        tile("Top 10 hold", it && it.scan && f.num(it.scan.top10_pct) ? it.scan.top10_pct + "%" : "—", null, "flat"));
    add(sc, tiles);
    out.push(sc);

    // simulated position
    if (pos || (cn && cn.position)) {
      var p = pos ? pos.p : null, pp = cn && cn.position;
      var pc = card(pos && !pos.open ? "Simulated trade (closed)" : "Simulated position", tags("sim"));
      var pnl = pp ? pp.pnl_usd : p && p.pnl_usd, pnlp = pp ? pp.pnl_pct : p && p.pnl_pct;
      add(pc, kvList([["Entry", f.price(pp ? pp.entry_price : p.entry_price)], ["Size", f.money(pp ? pp.size_usd : p.size_usd)], ["P&L", f.signed(pnl) + " (" + sgnPct(pnlp) + ")"],
        ["Stop", cn && cn.exit ? f.price(cn.exit.stop_price) + " (-" + cn.exit.stop_pct + "%)" : p && p.stop_price ? f.price(p.stop_price) : null],
        ["Trailing", cn && cn.exit ? (cn.exit.trail_active ? "armed at " + f.price(cn.exit.trail_price) : "not armed yet") : null],
        ["Exit", pos && !pos.open ? (p.exit_reason || "closed") + " at " + f.price(p.exit_price) : null],
        ["Opened", (pp ? pp.opened_at : p.opened_at) ? f.agoIso(pp ? pp.opened_at : p.opened_at) : null]]));
      out.push(pc);
    }

    // the Scanner's decision with its plain reason, both scores and the mandatory gates it was held to
    var sd = au && au.scanner;
    if (sd) out.push(scannerDecisionCard(sd, au.risk_facts));

    // audit
    var ac = card("Audit result", tags("market"));
    var layers = au && Array.isArray(au.layers) ? au.layers : null;
    if (layers) {
      add(ac, add(h("p", "audit-head"), h("strong", null, au.headline || (au.passed + "/" + au.total)), au.reason ? h("span", "muted", " · " + au.reason) : null));
      var ul = h("ul", "layers");
      layers.forEach(function (l) {
        var li = h("li", "layer layer-" + l.state);
        add(li, add(h("span", "layer-ico"), UI.icon(l.state === "pass" ? "check" : l.state === "fail" ? "x" : "eye", "icon")), h("span", "layer-n", l.name), h("span", "layer-v", l.value || ""));
        ul.appendChild(li);
      });
      add(ac, ul);
      if (au.analyst) add(ac, h("p", "audit-an", "Analyst score " + (f.num(au.analyst.score) ? au.analyst.score : "—") + (au.analyst.passed ? " · approved" : " · rejected" + (au.analyst.reason ? " (" + au.analyst.reason + ")" : ""))));
    } else if (it && it.audit && it.audit.state !== "none") {
      add(ac, h("p", "audit-head", it.audit.state + " · " + it.audit.passed + "/" + it.audit.total + " checks passed" + (it.audit.failed_layer ? " · failed: " + it.audit.failed_layer : "")));
    } else {
      add(ac, h("p", "muted", it && it.verdict === "killed" ? "This coin was rejected by the Scanner before the Auditor looked at it." : "No audit recorded for this coin yet."));
    }
    add(ac, h("p", "muted small", "The Auditor's eight checks and the Analyst's score decide. The Scanner's safety and opportunity scores above only explain."));
    out.push(ac);

    // FOMO (kept apart from everything else)
    var url = (cn && cn.coin_url) || (au && au.coin_url) || (it && it.coin_url) || (pos && pos.p.coin_url);
    var meta = cn || au || D().market || D().portfolio;
    var fb = url ? fomoBlock(url, meta) : null;
    if (fb) out.push(fb);
    return { name: name, sym: sym, nodes: out };
  }

  function drawCoinChart() {
    if (!coinRefs) return;
    var cn = coinRefs.cn, probe = coinRefs.probe;
    window.DeskCharts.candles(coinRefs.canvas, cn.candles, {
      lines: coinRefs.lines,
      fmtP: function (v) { return f.price(v).replace("$", ""); },
      fmtX: function (t) { return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); },
      onProbe: function (c) {
        probe.textContent = c ? new Date(c.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) + " · O " + f.price(c.o) + " H " + f.price(c.h) + " L " + f.price(c.l) + " C " + f.price(c.c) + " · vol " + (f.num(c.v) ? c.v.toFixed(0) : "—")
          : "Touch and drag on the chart for open, high, low, close";
      }
    });
  }

  function updateCoin() {
    var mint = A.selected();
    if (!mint) return;
    if (coinSel !== mint) { coinSel = mint; coinBox.__sig = null; }
    A.ensure("coin", mint, "/api/coin/" + mint, 30000);
    A.ensure("audit", mint, "/api/audit/" + mint, 60000);
    var cn = A.X.coin[mint], au = A.X.audit[mint], it = marketInfo(mint), pos = findPosition(mint);
    var sig = sigOf(mint, cn && [cn.price, cn.candles && cn.candles.length, cn.candles && cn.candles.length && cn.candles[cn.candles.length - 1].c, cn.position, cn.stats], au && [au.passed, au.state], it && [it.verdict, it.market], pos && pos.p,
      (A.XM["coin:" + mint] || {}).at ? 1 : 0, (A.XM["coin:" + mint] || {}).unavailable, A.isDemo(), Math.floor(Date.now() / 30000));
    if (coinBox.__sig !== sig) {
      coinBox.__sig = sig;
      var res = coinBody(mint);
      document.getElementById("coin-title").textContent = res.name + (res.sym ? " (" + res.sym + ")" : "");
      coinBox.replaceChildren.apply(coinBox, res.nodes);
      drawCoinChart();
    }
  }
  A.register("coin", { enter: updateCoin, update: updateCoin });
  document.getElementById("coin-back").addEventListener("click", function () { A.go(A.selectedFrom() || "dashboard"); });

  window.addEventListener("resize", function () {
    if (A.route() === "dashboard" && dash && D().portfolio) { dash.eq.sig = null; drawEquity(); }
    if (A.route() === "coin") drawCoinChart();
  });
})();
