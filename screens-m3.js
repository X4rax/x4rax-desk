/* Milestone 3 screens: #analytics, #alerts, #settings. Drawn only from the Worker payloads DeskApp holds:
   analytics (SIMULATION statistics from real PAPER records, MARKET DATA funnel + scores, BACKTEST evaluation, execution protections,
   recorded alerts, data freshness) and settings (the desk's settings, read-only here). Rules this file keeps:
   - a number the desk did not record is "—", never 0; under the sample threshold the screen says INSUFFICIENT DATA and shows no verdict;
   - a backtest is labelled BACKTEST with its limitations next to the figures; nothing here applies a setting;
   - DOM is built with textContent only (strict CSP, no inline styles); one input exists in the app: the pairing code. */
(function () {
  "use strict";
  var A = window.DeskApp, UI = window.DeskUI;
  var h = UI.h, add = UI.add, f = UI.fmt;

  function D() { return A.D(); }
  function M() { return A.M(); }
  function box(id) { return document.getElementById(id); }
  function sig() { return JSON.stringify(Array.prototype.slice.call(arguments)); }
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
  function dash(n, fn) { return f.num(n) ? fn(n) : "—"; }
  function usd(n) { return dash(n, function (x) { return (x < 0 ? "-$" : "$") + Math.abs(x).toFixed(2); }); }
  function sUsd(n) { return dash(n, function (x) { return (x < 0 ? "-$" : "+$") + Math.abs(x).toFixed(2); }); }
  function pc(n, d) { return dash(n, function (x) { return (x * 100).toFixed(d === undefined ? 0 : d) + "%"; }); }
  function pn(n, d) { return dash(n, function (x) { return (x >= 0 ? "+" : "") + x.toFixed(d === undefined ? 1 : d) + "%"; }); }
  function tone(n) { return f.tone(n); }
  function tile(label, value, sub, tn, weak) {
    var t = h("div", "tile" + (weak ? " is-weak" : ""));
    add(t, h("span", "tile-k", label), h("strong", "tile-v tone-" + (tn || "flat"), value), sub ? h("span", "tile-sub", sub) : null);
    return t;
  }
  function kv(pairs) {
    var dl = h("dl", "kv");
    pairs.forEach(function (p) { add(dl, h("dt", null, p[0]), h("dd", null, p[1] === null || p[1] === undefined || p[1] === "" ? "—" : String(p[1]))); });
    return dl;
  }
  function ciText(ci, fmt) { return ci && ci.length === 2 ? "95% CI " + fmt(ci[0]) + " to " + fmt(ci[1]) : "no interval"; }

  /* A card for a payload that is missing: loading, not available on the Worker yet, or a failed fetch. Never invents content. */
  function stateBody(key, what) {
    var m = M()[key] || {};
    if (m.unavailable) return UI.empty("chart", "Not available yet", what + " needs the upgraded Worker. Nothing is shown in its place.");
    if (m.error === "offline" || /^http_/.test(m.error || "")) {
      var wrap = h("div", "state-error");
      add(wrap, UI.empty("link", m.error === "offline" ? "You're offline" : "The desk link returned an error", "Couldn't load " + what + (m.error === "offline" ? "." : " (" + m.error.replace("http_", "HTTP ") + ")."), ""));
      var b = h("button", "btn btn-ghost", "Try again");
      b.type = "button";
      b.addEventListener("click", function () { A.kick(); });
      add(wrap, b);
      return wrap;
    }
    return UI.skeleton(5);
  }
  function stale(key) {
    var m = M()[key] || {};
    if (m.error === "offline" || /^http_/.test(m.error || "")) return h("p", "stale-note", "Couldn't refresh just now. Showing the last data received" + (m.at ? " at " + f.clock(new Date(m.at).toISOString()) : "") + ".");
    return null;
  }
  function chartCanvas(label) {
    var c = document.createElement("canvas");
    c.className = "chart-canvas";
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", label);
    return c;
  }
  function sectionNav(items) {
    var nav = h("nav", "jump");
    nav.setAttribute("aria-label", "Analytics sections");
    items.forEach(function (it) {
      var b = h("button", "chip jump-chip", it[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        var el = document.getElementById(it[0]);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: UI.reducedMotion() ? "auto" : "smooth", block: "start" });
      });
      add(nav, b);
    });
    return nav;
  }

  /* ----- small SVG bar chart (daily P&L): positive up, negative down; accessible text list sits under it ----- */
  function barsSvg(rows) {
    var W = 320, H = 110, mid = 55, n = rows.length;
    var svg = UI.svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Daily simulated P&L, " + n + " day" + (n === 1 ? "" : "s"), preserveAspectRatio: "none" }, "bars-svg");
    svg.appendChild(UI.svgEl("line", { x1: 0, x2: W, y1: mid, y2: mid }, "bars-axis"));
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.pnl_usd); }).concat([1]));
    var bw = Math.min(28, (W - 10) / Math.max(n, 1) - 4);
    rows.forEach(function (r, i) {
      var hgt = Math.max(1.5, (Math.abs(r.pnl_usd) / max) * (mid - 8));
      var x = 6 + i * ((W - 12) / Math.max(n, 1)) + 2;
      svg.appendChild(UI.svgEl("rect", { x: x.toFixed(1), y: (r.pnl_usd >= 0 ? mid - hgt : mid).toFixed(1), width: bw.toFixed(1), height: hgt.toFixed(1), rx: 2 }, r.pnl_usd >= 0 ? "bar-up" : "bar-down"));
    });
    return svg;
  }

  /* ================================================================ #analytics */
  var anBox = box("analytics-body");
  var chartState = {};

  function simCard(s) {
    var c = card("PAPER simulation", tags("sim"));
    var weak = !s.meaningful;
    add(c, h("p", "honesty honesty-" + s.evidence, s.note));
    var cap = s.capital || {};
    add(c, h("h4", "sub", "Capital (simulated, started at " + usd(cap.start_usd) + ")"));
    add(c, add(h("div", "tiles"), tile("Equity", usd(cap.equity_usd), "marked to market", "flat"), tile("Realised", sUsd(cap.realised_pnl_usd), "closed trades", tone(cap.realised_pnl_usd)),
      tile("Unrealised", sUsd(cap.unrealised_pnl_usd), "open positions", tone(cap.unrealised_pnl_usd)), tile("Available", usd(cap.available_usd), "not in a position", "flat"),
      tile("In positions", usd(cap.open_exposure_usd), "cost basis", "flat"), tile("Closed trades", String(s.closed_trades), "need " + s.min_for_stats + " for stats", "flat")));
    add(c, h("h4", "sub", "Performance" + (weak ? " · not yet meaningful" : "")));
    add(c, add(h("div", "tiles"),
      tile("Win rate", pc(s.win_rate), s.win_rate === null ? "no trades" : ciText(s.win_rate_ci95, function (x) { return pc(x); }), "flat", weak),
      tile("Avg win", usd(s.avg_win_usd), "", "up", weak), tile("Avg loss", s.avg_loss_usd === null || s.avg_loss_usd === undefined ? "—" : "-" + usd(s.avg_loss_usd), "", "down", weak),
      tile("Risk/reward", dash(s.risk_reward, function (x) { return x.toFixed(2); }), "avg win ÷ avg loss", "flat", weak),
      tile("Profit factor", dash(s.profit_factor, function (x) { return x.toFixed(2); }), "wins ÷ losses", "flat", weak),
      tile("Expectancy", sUsd(s.expectancy_usd), s.expectancy_pct === null ? "per trade" : pn(s.expectancy_pct) + " · " + ciText(s.expectancy_pct_ci95, function (x) { return pn(x); }), tone(s.expectancy_usd), weak),
      tile("Max drawdown", dash(s.max_drawdown_realized_pct, function (x) { return "-" + x.toFixed(1) + "%"; }), "realised, " + usd(s.max_drawdown_realized_usd), "down", weak),
      tile("Avg holding", dash(s.avg_hold_min, function (x) { return x < 90 ? Math.round(x) + " min" : (x / 60).toFixed(1) + " h"; }), "open to close", "flat", weak),
      tile("Total P&L", sUsd(s.total_pnl_usd), "after fees + slippage", tone(s.total_pnl_usd), weak)));
    if (s.breakeven_win_rate !== null && s.breakeven_win_rate !== undefined) add(c, h("p", "muted small", "Break-even win rate at the current average win/loss: " + pc(s.breakeven_win_rate) + "."));
    var co = s.costs || {};
    add(c, h("h4", "sub", "Costs"));
    add(c, kv([["Fees paid", usd(co.fees_usd)], ["Slippage (modelled)", co.slippage_usd === null || co.slippage_usd === undefined ? "not recorded" : usd(co.slippage_usd)],
      ["P&L before costs", sUsd(co.gross_pnl_before_costs_usd)], ["Round-trip fee at the smallest ticket", dash(co.round_trip_fee_at_min_ticket_pct, function (x) { return x.toFixed(1) + "% of the ticket"; })],
      ["Slippage model", co.model]]));
    add(c, h("p", "muted small", "Slippage and fees are modelled assumptions (constant-product impact on the pool's liquidity, plus a flat allowance). The desk never places an order, so real fills can differ."));
    return c;
  }

  function chartsCard(s) {
    var c = card("Charts", tags("sim"));
    var ch = s.charts || {};
    var eqPts = (ch.equity_mtm && ch.equity_mtm.length > 1) ? ch.equity_mtm : (ch.equity_realised || []);
    add(c, h("h4", "sub", "Equity curve"));
    var eq = chartCanvas(eqPts.length > 1 ? "Equity curve, " + usd(eqPts[0].v) + " to " + usd(eqPts[eqPts.length - 1].v) : "No equity history yet");
    var eqRead = h("p", "chart-read muted small", "");
    add(c, eq, eqRead);
    add(c, h("h4", "sub", "Drawdown from peak (closed trades)"));
    var ddPts = ch.drawdown_realised_pct || [];
    var dd = chartCanvas(ddPts.length > 1 ? "Drawdown, worst " + Math.max.apply(null, ddPts.map(function (p) { return p.v; })).toFixed(1) + " percent" : "No drawdown history yet");
    var ddRead = h("p", "chart-read muted small", "");
    add(c, dd, ddRead);
    add(c, h("h4", "sub", "Daily P&L"));
    var days = ch.daily_pnl || [];
    if (days.length) {
      add(c, barsSvg(days));
      var ul = h("ul", "mini-list");
      days.slice(-7).forEach(function (d) { add(ul, add(h("li"), h("span", null, d.day), h("strong", "tone-" + tone(d.pnl_usd), sUsd(d.pnl_usd)))); });
      add(c, ul);
    } else add(c, UI.empty("chart", "No closed trades yet", "Daily results appear after the first simulated trade closes."));
    var w = {
      eq: { pts: eqPts, canvas: eq, read: eqRead, fmt: function (v) { return "$" + v.toFixed(v >= 1000 ? 0 : 1); } },
      dd: { pts: ddPts, canvas: dd, read: ddRead, fmt: function (v) { return v.toFixed(1) + "%"; } }
    };
    chartState.pending = w;
    return c;
  }
  function drawCharts() {
    var w = chartState.pending;
    if (!w || !window.DeskCharts) return;
    Object.keys(w).forEach(function (k) {
      var x = w[k];
      if (!x.canvas.isConnected) return;
      function readout(p) {
        if (!p) { x.read.textContent = x.pts.length > 1 ? "Touch the chart to read a point." : "Not enough points to draw a line yet."; return; }
        x.read.textContent = new Date(p.t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " · " + x.fmt(p.v);
      }
      window.DeskCharts.equity(x.canvas, x.pts, { base: k === "eq" ? D().analytics.sim.capital.start_usd : 0, fmtY: x.fmt,
        fmtX: function (t) { return new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" }); }, onProbe: readout });
      readout(null);
    });
  }

  function tradesCard(s) {
    var c = card("Trades and breakdowns", tags("sim"));
    if (!s.closed_trades) return add(c, UI.empty("positions", "No closed trades yet", "Best and worst trades, results by token and by exit type appear once simulated trades close."));
    function list(title, rows, fmt) {
      add(c, h("h4", "sub", title));
      var ul = h("ul", "mini-list");
      rows.forEach(function (r) { add(ul, fmt(r)); });
      if (!rows.length) add(ul, add(h("li"), h("span", "muted", "None")));
      add(c, ul);
    }
    function row(name, sub, pnl) { return add(h("li"), add(h("span", null, name), sub ? h("small", null, " " + sub) : null), h("strong", "tone-" + tone(pnl), sUsd(pnl))); }
    list("Best trades", s.best_trades || [], function (t) { return row(t.name, (t.reason || "") + (t.pct !== null && t.pct !== undefined ? " · " + pn(t.pct) : ""), t.pnl_usd); });
    list("Worst trades", s.worst_trades || [], function (t) { return row(t.name, (t.reason || "") + (t.pct !== null && t.pct !== undefined ? " · " + pn(t.pct) : ""), t.pnl_usd); });
    list("By token", s.by_token || [], function (t) { return row(t.name, t.n + " trade" + (t.n === 1 ? "" : "s"), t.pnl_usd); });
    list("By exit type (the one live strategy)", s.exit_reasons || [], function (t) { return row(t.reason, t.n + " trade" + (t.n === 1 ? "" : "s") + " · " + t.wins + " won", t.avg_pnl_usd); });
    list("By day", (s.by_day || []).slice().reverse().slice(0, 7), function (t) { return row(t.day, t.n + " trade" + (t.n === 1 ? "" : "s"), t.pnl_usd); });
    add(c, h("p", "muted small", s.strategy_note + " The 'by exit type' rows show the average P&L per trade."));
    return c;
  }

  function funnelCard(fn, label) {
    var c = card(label, tags("market"));
    if (!fn.decided) return add(c, UI.empty("scanner", "Nothing judged yet", "The Scanner has not reached a verdict in this window."));
    add(c, h("p", "lead", fn.passed + " of " + fn.decided + " passed" + (fn.one_in ? " · about 1 in " + fn.one_in : "")));
    add(c, h("p", "muted small", ciText(fn.pass_rate_ci95, function (x) { return pc(x, 1); }) + " (" + fn.window + "). A strict filter is expected to pass few."));
    var max = fn.decided || 1;
    var ul = h("ul", "funnel");
    (fn.stages || []).forEach(function (st, i) {
      var li = h("li", "funnel-row");
      add(li, h("span", "funnel-k", st.label), h("strong", "funnel-v", String(st.n)), UI.bar((st.n / max) * 100, i === 0 ? "scanner" : i === 3 ? "executor" : "auditor"));
      ul.appendChild(li);
    });
    add(c, ul);
    add(c, h("h4", "sub", "Rejection categories"));
    var kl = h("ul", "funnel");
    (fn.kills || []).forEach(function (k) {
      var li = h("li", "funnel-row");
      add(li, h("span", "funnel-k", k.reason), h("strong", "funnel-v", k.n + (f.num(k.share) ? " · " + Math.round(k.share * 100) + "%" : "")), UI.bar((k.share || 0) * 100, "risk"));
      kl.appendChild(li);
    });
    add(c, kl);
    var la = fn.liquidity_kill_age;
    if (la && la.median_min !== null && la.median_min !== undefined) add(c, h("p", "muted small", "Liquidity rejections are decided at a median pool age of " + la.median_min + " min; " + pc(la.share_under_2_min) + " under 2 min. A fresh pool's liquidity is still being seeded, so an age-matched check is proposed (docs/scanner-filters.md), not applied."));
    if ((fn.never_qualified_causes || []).length) {
      add(c, h("h4", "sub", "Why 'never qualified' coins were dropped"));
      var nl = h("ul", "mini-list");
      fn.never_qualified_causes.forEach(function (x) { add(nl, add(h("li"), h("span", null, x.label), h("strong", null, String(x.n)))); });
      add(c, nl);
    }
    return c;
  }

  function scoreChip(label, v, cov) {
    if (v === null || v === undefined) return UI.chip(label + " —", "flat");
    return UI.chip(label + " " + v, v >= 70 ? "up" : v >= 40 ? "warn" : "down");
  }
  function tokenRow(t) {
    var d = h("details", "tok");
    var sm = h("summary", "tok-sum");
    add(sm, add(h("span", "tok-name"), h("strong", null, t.name), UI.chip(t.verdict === "pass" ? "PASSED" : t.verdict === "kill" ? "REJECTED" : "WATCHING", t.verdict === "pass" ? "up" : t.verdict === "kill" ? "down" : "info")),
      add(h("span", "tok-scores"), scoreChip("Safety", t.safety), scoreChip("Opportunity", t.opportunity)), h("span", "tok-why", t.why));
    add(d, sm);
    var body = h("div", "tok-body");
    add(body, h("h5", "sub", "Mandatory gates (pass or fail, never part of a score)"));
    var gl = h("ul", "gates");
    (t.gates || []).forEach(function (g) {
      add(gl, add(h("li", "gate gate-" + (g[1] === true ? "pass" : g[1] === false ? "fail" : "na")), h("span", null, g[0]), h("span", null, g[2] + " (needs " + g[3] + ")"),
        h("strong", null, g[1] === true ? "pass" : g[1] === false ? "FAIL" : "not measured")));
    });
    add(body, gl);
    function parts(title, rows, cov) {
      add(body, h("h5", "sub", title));
      if (!rows || !rows.length) { add(body, h("p", "muted small", "No score: too little of it could be measured (" + Math.round((cov || 0) * 100) + "% of the formula had data).")); return; }
      var ul = h("ul", "mini-list");
      rows.forEach(function (r) { add(ul, add(h("li"), h("span", null, r[0] + " · " + r[3]), h("strong", null, r[1] === null ? "unavailable" : r[1] + " / " + r[2]))); });
      add(body, ul);
    }
    parts("Safety score parts", t.safety_parts, t.safety_coverage);
    if (t.unavailable && t.unavailable.length) add(body, h("p", "muted small", "Not measured for this token: " + t.unavailable.join(", ") + "."));
    parts("Opportunity score parts", t.opportunity_parts, t.opportunity_coverage);
    (t.flags || []).forEach(function (x) { add(body, h("p", "flag-line", "⚠ " + x)); });
    var open = h("button", "btn-link", "Open coin");
    open.type = "button";
    open.addEventListener("click", function () { if (A.select(t.mint, "analytics")) A.go("coin"); });
    add(body, open);
    add(d, body);
    return d;
  }
  function tokensCard(tk) {
    var c = card("Scanner scores and reasons", tags("market"));
    add(c, h("p", "muted small", tk.note));
    add(c, h("h4", "sub", "Mandatory safety gates (fixed)"));
    var ml = h("ul", "mini-list");
    (tk.mandatory || []).forEach(function (m) { add(ml, add(h("li"), h("span", null, m.label), h("strong", null, m.limit === null || m.limit === undefined ? "all layers" : String(m.limit)))); });
    add(c, ml);
    add(c, h("h4", "sub", "Adjustable opportunity thresholds (Analyst)"));
    var al = h("ul", "mini-list");
    (tk.adjustable || []).forEach(function (m) { add(al, add(h("li"), h("span", null, m.setting.replace("analyst.", "").replace(/_/g, " ")), h("strong", null, String(m.value)))); });
    add(c, al);
    var fd = h("details", "formula");
    add(fd, h("summary", null, "How the scores are computed"), h("p", "muted small", tk.safety_formula), h("p", "muted small", tk.opportunity_formula));
    add(c, fd);
    add(c, h("h4", "sub", "Latest verdicts (" + (tk.shown || 0) + ")"));
    if (!(tk.items || []).length) add(c, UI.empty("scanner", "No verdicts yet", "Each token the Scanner judges is listed here with its reason."));
    (tk.items || []).forEach(function (t) { add(c, tokenRow(t)); });
    return c;
  }

  function missedCard(m) {
    var c = card("Rejected tokens: what happened next", tags("market"));
    add(c, h("p", "honesty honesty-" + (m.tracked >= 30 ? "inconclusive" : "insufficient"), m.note));
    var ul = h("ul", "mini-list");
    (m.categories || []).forEach(function (x) {
      add(ul, add(h("li"), h("span", null, x.category + " · " + x.rejected + " rejected, " + x.tracked + " tracked"),
        h("strong", null, x.tracked ? x.rose_50 + " rose 50%+" + (x.median_best_pct !== null ? " · median best " + pn(x.median_best_pct, 0) : "") : "no data")));
    });
    add(c, ul);
    if ((m.examples || []).length) {
      add(c, h("h4", "sub", "Biggest rises after a rejection (hindsight)"));
      var el = h("ul", "mini-list");
      m.examples.forEach(function (e) { add(el, add(h("li"), h("span", null, e.name + " · " + e.reason), h("strong", null, "best " + pn(e.best_pct, 0) + " · last " + pn(e.last_pct, 0)))); });
      add(c, el);
    }
    return c;
  }

  function evalRow(label, st) {
    return add(h("li", "eval-row"), h("span", "eval-k", label), h("span", "eval-v", st.trades ? st.trades + " trades · mean " + pn(st.mean_pct) + " · win " + pc(st.win_rate) : "no trades"),
      UI.chip(st.insufficient ? "insufficient" : st.evidence, st.evidence === "positive" ? "up" : st.evidence === "negative" ? "down" : "flat"));
  }
  function backtestCard(b) {
    var c = card("Strategy evaluation", add(h("span", "tags"), h("span", "src-tag src-backtest", "BACKTEST"), A.isDemo() ? UI.srcTag("demo") : null));
    add(c, h("p", "honesty honesty-insufficient", b.label + ". " + b.note));
    add(c, kv([["Entries replayed", b.entries], ["Coins with stored prices", b.coins_replayed + " of " + b.scanner_passes_seen + " Scanner passes"], ["Price sampling gap", dash(b.median_gap_s, function (x) { return "median " + x + " s"; })],
      ["Ticket size", usd(b.ticket_usd)], ["Applied automatically", b.auto_apply ? "yes" : "never"]]));
    add(c, h("p", "muted small", b.split.how + "."));
    add(c, h("h4", "sub", "Benchmark"));
    add(c, add(h("ul", "eval"), evalRow("All (same costs)", b.benchmark), evalRow("Out-of-sample", b.benchmark.out_of_sample)));
    (b.sets || []).forEach(function (st) {
      add(c, h("h4", "sub", st.label));
      add(c, add(h("ul", "eval"), evalRow("All", st), evalRow("In-sample", st.in_sample), evalRow("Out-of-sample", st.out_of_sample)));
    });
    add(c, h("h4", "sub", "Overfitting check"));
    add(c, h("p", "muted", b.overfitting.verdict), h("p", "muted small", b.overfitting.warning));
    var lim = h("ul", "bul");
    (b.limitations || []).forEach(function (x) { add(lim, h("li", null, x)); });
    add(c, h("h4", "sub", "Limitations"), lim);
    return c;
  }

  function guardsCard(g) {
    var c = card("PAPER execution protections", tags("sim"));
    add(c, add(h("p", "lead"), h("span", "dot dot-" + (g.all_clear ? "ok" : "warn")), document.createTextNode(g.all_clear ? " All circuit breakers clear" : " " + g.breakers.length + " breaker" + (g.breakers.length === 1 ? "" : "s") + " tripped: new entries paused")));
    (g.breakers || []).forEach(function (b) { add(c, h("p", "flag-line", "⚠ " + b.label + ": " + b.detail)); });
    var dl = g.daily_loss, l = g.limits;
    add(c, kv([["Start stack", usd(g.start_stack_usd)], ["Daily loss limit", dl.limit_pct ? dl.limit_pct + "% (" + usd(dl.limit_usd) + ") · today " + sUsd(dl.realised_today_usd) + (dl.tripped ? " · TRIPPED" : "") : "off"],
      ["Max exposure per token", l.max_token_pct ? l.max_token_pct + "% of the stack" : "off"], ["Max entry slippage", l.max_entry_slippage_bps ? l.max_entry_slippage_bps + " bps" : "off"],
      ["Abnormal-move breaker", l.max_move_pct ? l.max_move_pct + "% from the Analyst's price" : "off"], ["Duplicate-order window", l.duplicate_h + " h"],
      ["Stale-data breaker", "balance older than " + l.stale_balance_s + " s"], ["RPC breaker", l.rpc_fail_n + " errors in a row"],
      ["Stop / trail / take-profit", "-" + l.stop_pct + "% / " + l.trail_pct + "% / " + (l.take_profit_pct ? "+" + l.take_profit_pct + "%" : "off")]]));
    add(c, h("p", "muted small", g.note + " Liquidity-aware sizing caps a ticket at a share of the pool; an entry the model says would pay too much slippage, or whose liquidity is unknown, is refused with its reason."));
    return c;
  }

  function limitsCard(a) {
    var c = card("Data quality and limits", tags("market"));
    var q = a.quality || {};
    if (q.empty) add(c, h("p", "muted", "No audited coin has recorded holder facts yet."));
    else add(c, kv([["Audited coins with facts", q.audited_with_facts], ["Largest real holder (median / max)", dash(q.top1_median_pct, function (x) { return x.toFixed(1) + "%"; }) + " / " + dash(q.top1_max_pct, function (x) { return x.toFixed(1) + "%"; })],
      ["Insider-held share (median)", dash(q.insider_net_median_pct, function (x) { return x.toFixed(1) + "%"; })]]));
    add(c, h("p", "muted small", q.note || ""));
    var sh = a.shadow || {};
    add(c, h("p", "muted", "Shadow tracking: " + (sh.enabled ? "ON (" + sh.track_hours + " h after a verdict)" : "OFF")), h("p", "muted small", sh.note || ""));
    var ul = h("ul", "bul");
    (a.limits || []).forEach(function (x) { add(ul, h("li", null, x)); });
    add(c, h("h4", "sub", "Known limitations"), ul);
    return c;
  }

  function analyticsBody() {
    var a = D().analytics;
    if (!a) { var c0 = card("Analytics", tags("sim")); add(c0, stateBody("analytics", "Analytics")); return [c0]; }
    var out = [];
    out.push(sectionNav([["an-sim", "Simulation"], ["an-charts", "Charts"], ["an-scanner", "Scanner"], ["an-tokens", "Scores"], ["an-eval", "Strategy"], ["an-guards", "Protections"]]));
    var s = stale("analytics");
    if (s) out.push(s);
    var parts = [["an-sim", simCard(a.sim)], ["an-charts", chartsCard(a.sim)], ["an-trades", tradesCard(a.sim)], ["an-scanner", funnelCard(a.funnel, "Scanner funnel (all recorded)")],
      ["an-funnel24", funnelCard(a.funnel_24h, "Scanner funnel (last 24 h)")], ["an-tokens", tokensCard(a.tokens)], ["an-missed", missedCard(a.missed)], ["an-eval", backtestCard(a.backtest)],
      ["an-guards", guardsCard(a.guards)], ["an-limits", limitsCard(a)]];
    parts.forEach(function (p) { p[1].id = p[0]; out.push(p[1]); });
    return out;
  }
  A.register("analytics", { enter: updateAnalytics, update: updateAnalytics, leave: function () { chartState.pending = null; } });
  function updateAnalytics() {
    var a = D().analytics, m = M().analytics || {};
    var rebuilt = UI.memo(anBox, sig(a && [a.sim, a.funnel, a.funnel_24h, a.tokens, a.missed, a.backtest, a.guards, a.quality, a.shadow], m.unavailable, m.error, A.isDemo()), analyticsBody);
    if (rebuilt) window.requestAnimationFrame(drawCharts);
  }
  window.addEventListener("resize", function () { if (A.route() === "analytics" && D().analytics) { anBox.__sig = null; updateAnalytics(); } });

  /* ================================================================ #alerts */
  var alBox = box("alerts-body");
  var SEV = { info: ["info", "Info"], warn: ["warn", "Warning"], bad: ["down", "Critical"] };
  var STATUS_TONE = { ok: "up", stale: "warn", failing: "down", unknown: "flat", info: "info", off: "flat" };

  function ageText(iso) { return iso ? f.agoIso(iso) : "never"; }
  function freshnessCard(mon) {
    var c = card("Data freshness and Worker sync", tags("sim"));
    var ws = mon.worker_sync || {};
    add(c, h("h4", "sub", "Worker sync (desk to Worker to this app)"));
    add(c, kv([["Status", ws.status === "off" ? "off on this desk" : ws.status], ["Last successful push", ws.last_ok_at ? f.clock(ws.last_ok_at) + " (" + ageText(ws.last_ok_at) + ")" : "—"],
      ["Failures in a row", ws.enabled ? String(ws.consecutive_failures) : "—"]]));
    if (ws.note) add(c, h("p", "muted small", ws.note));
    add(c, h("h4", "sub", "Data feeds"));
    var ul = h("ul", "fresh");
    (mon.items || []).forEach(function (it) {
      add(ul, add(h("li"), add(h("span", "fresh-k"), h("strong", null, it.label), it.note ? h("small", null, it.note) : null), add(h("span", "fresh-v"), h("span", null, ageText(it.last_at)), UI.chip(it.status, STATUS_TONE[it.status] || "flat"))));
    });
    add(c, ul);
    var pc_ = mon.push_channel || {};
    add(c, h("h4", "sub", "Phone alerts (yes/no facts only)"));
    add(c, kv([["Sending switched on at the desk", pc_.enabled ? "yes" : "no (default)"], ["Push library installed", pc_.library ? "yes" : "no"], ["Signing key present", pc_.vapid_key ? "yes" : "no"],
      ["Registered iPhones", String(pc_.subscriptions === undefined ? "—" : pc_.subscriptions)], ["Quiet hours", pc_.quiet_hours || "off"], ["Max pushes per hour", pc_.max_per_hour]]));
    return c;
  }
  function alertRow(a) {
    var sv = SEV[a.severity] || SEV.info;
    var li = h("li", "alert-row sev-" + a.severity);
    add(li, add(h("div", "alert-top"), UI.chip(sv[1], sv[0]), h("span", "alert-time", f.agoIso(a.ts))), h("strong", "alert-title", a.title), a.body ? h("p", "alert-body", a.body) : null,
      h("span", "alert-push", a.pushed ? "Pushed to the phone" : "In-app only" + (a.push_note ? " · " + a.push_note : "")));
    return li;
  }
  function alertsBody() {
    var a = D().analytics;
    if (!a) { var c0 = card("Alerts", tags("sim")); add(c0, stateBody("analytics", "Alerts")); return [c0]; }
    var out = [];
    var s = stale("analytics");
    if (s) out.push(s);
    var c = card("Recorded alerts", tags("sim"));
    add(c, h("p", "muted small", "Seven kinds, each de-duplicated: a token passing every check, a position opening, a position closing, a stop / trailing / take-profit exit, a daily PAPER summary, agent errors or missing heartbeats, and Worker connectivity. Alerts never contain keys, URLs or settings."));
    if (!(a.alerts || []).length) add(c, UI.empty("bell", "No alerts yet", "Nothing has happened that needed one. Alerts are recorded here whether or not push is switched on."));
    else { var ul = h("ul", "alerts"); a.alerts.forEach(function (x) { add(ul, alertRow(x)); }); add(c, ul); }
    out.push(c, freshnessCard(a.monitor));
    return out;
  }
  A.register("alerts", { enter: updateAlerts, update: updateAlerts });
  function updateAlerts() {
    var a = D().analytics, m = M().analytics || {};
    UI.memo(alBox, sig(a && [a.alerts, a.monitor], m.unavailable, m.error, Math.floor(Date.now() / 30000), A.isDemo()), alertsBody);
  }

  /* ================================================================ #settings */
  var seBox = box("settings-body");
  var MANDATORY_GROUPS = { scanner: "Mandatory safety gates", auditor: "Mandatory safety gates", guard: "Execution protections (only ever block entries)" };
  var ADJUSTABLE_GROUPS = { analyst: "Adjustable opportunity thresholds" };
  var appBits = { alerts: "", cache: null };

  function settingValue(s) {
    if (s.value === null || s.value === undefined || s.value === "") return "—";
    if (s.type === "bool") return s.value ? "on" : "off";
    return String(s.value);
  }
  function deskSettingsCard() {
    var c = card("Desk settings (read only)", tags("sim"));
    add(c, h("p", "muted small", "These are the desk's own settings as last synced. This app can't change them. Change them on the desk; nothing here loosens a safety filter, and optimised settings are never applied automatically."));
    var st = D().settings;
    if (!st) { add(c, stateBody("settings", "Desk settings")); return c; }
    var names = Object.keys(st.groups || {}).sort();
    names.forEach(function (g) {
      var d = h("details", "setgrp");
      var tag = MANDATORY_GROUPS[g] || ADJUSTABLE_GROUPS[g] || "";
      add(d, add(h("summary", "setgrp-sum"), h("strong", null, g), tag ? h("small", null, tag) : null, h("span", "setgrp-n", String(st.groups[g].length))));
      var dl = h("dl", "kv");
      st.groups[g].forEach(function (s) {
        add(dl, h("dt", null, s.label), h("dd", null, settingValue(s)));
      });
      add(d, dl);
      add(c, d);
    });
    return c;
  }
  function appCard() {
    var c = card("This app", tags("desk"));
    var items = h("ul", "set-list");
    function row(title, sub, ctl) { add(items, add(h("li", "set-row"), add(h("span", "set-k"), h("strong", null, title), sub ? h("small", null, sub) : null), ctl)); }
    function btn(text, fn, cls) { var b = h("button", "btn " + (cls || "btn-ghost") + " set-btn", text); b.type = "button"; b.addEventListener("click", fn); return b; }
    var sup = A.alertsSupport();
    var alertStatus = h("p", "muted small set-status", appBits.alerts || (sup.ok ? (sup.permission === "granted" ? "Notifications are allowed for this app." : "Not registered yet.") : sup.text));
    alertStatus.setAttribute("role", "status");
    var alertBtn = btn("Register this iPhone", function () {
      alertBtn.disabled = true;
      alertStatus.textContent = "Registering…";
      A.enableAlerts().then(function (r) { appBits.alerts = r.text; alertStatus.textContent = r.text; alertBtn.disabled = false; });
    });
    if (!sup.ok) alertBtn.disabled = true;
    row("Phone alerts", "Registers this iPhone to receive alerts. Delivery stays off until it's switched on at the desk.", alertBtn);
    add(items, alertStatus);
    row("Alerts and data freshness", "Recorded alerts, Worker sync, feed ages.", btn("Open", function () { A.go("alerts"); }));
    row("FOMO connection", "Read-only links to FOMO. The desk never trades.", btn("Open", function () { A.go("fomo"); }));
    row("Start-up replay", "Play the splash and agent start-up flow again.", btn("Show startup", function () { A.startFlow(); }));
    var rm = UI.reducedMotion();
    row("Reduced motion", rm ? "On: this device asks for less motion, so animations are skipped." : "Off. Turn on Reduce Motion in iOS Settings > Accessibility > Motion and the app follows it.", UI.chip(rm ? "on" : "off", rm ? "up" : "flat"));
    var cacheEl = h("span", "set-ver", appBits.cache === null ? "…" : appBits.cache);
    row("Version and cache", "Service worker cache that holds the app files.", cacheEl);
    A.cacheInfo().then(function (keys) { appBits.cache = keys && keys.length ? keys.join(", ") : "no cache (first load or private mode)"; cacheEl.textContent = appBits.cache; });
    add(c, items);
    var danger = h("div", "danger");
    add(danger, h("p", "muted small", "Unpair forgets this iPhone's pairing token here and revokes it at the Worker. You will need a new pairing code from the desk."),
      btn("Unpair this iPhone", function () { if (window.confirm("Unpair this iPhone? You'll need a new pairing code.")) A.unpair(); }, "btn-danger"));
    add(c, danger);
    return c;
  }
  function settingsBody() { return [appCard(), deskSettingsCard()]; }
  A.register("settings", { enter: function () { seBox.__sig = null; updateSettings(); }, update: updateSettings });
  function updateSettings() {
    var s = D().settings, m = M().settings || {};
    UI.memo(seBox, sig(s && s.values, m.unavailable, m.error, A.isDemo(), appBits.alerts), settingsBody);
  }
})();
