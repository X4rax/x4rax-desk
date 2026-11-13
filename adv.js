/* Advanced Dashboard model (v11). PURE functions: no DOM, no network, no storage. They turn the Worker payloads that DeskApp already
   holds into display models. Rules (docs/f1-plan.md, F1.2):
   - every number shown is a payload field, or plain arithmetic on two payload fields (equity minus the start stack, equity over the
     start stack); nothing is estimated, extrapolated or padded;
   - a missing field means "unavailable" (the screen then says "Not available yet"), never a guess;
   - the 30D tab never shows ALL as if it were a 30-day chart: chart:ALL carries `window_30d` (Worker v2 has no chart:30D key):
       uses "own"  -> the real last-30-days series the desk built (only once 30 days exist),
       uses "all"  -> all recorded history, labelled "Only X days of history — showing all available",
       missing / inconsistent -> unavailable. */
(function () {
  "use strict";
  var TABS = [
    { id: "24H", key: "1D", label: "24H", long: "last 24 hours", ttl: 60000 },
    { id: "7D", key: "1W", label: "7D", long: "last 7 days", ttl: 300000 },
    { id: "30D", key: "ALL", label: "30D", long: "last 30 days", ttl: 300000, win30: true },
    { id: "ALL", key: "ALL", label: "ALL", long: "all recorded history", ttl: 300000 }
  ];
  var STALE_AFTER_MS = 90000;
  var NA = "Not available yet";

  function num(n) { return typeof n === "number" && isFinite(n); }
  function first() { for (var i = 0; i < arguments.length; i++) if (num(arguments[i])) return arguments[i]; return null; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function tabById(id) { for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i]; return TABS[0]; }

  function cleanPoints(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (p) { return p && num(p.t) && num(p.v); });
  }

  /* "Only 1.9 days of history" / "Only 5 hours of history" (coverage_days is rounded to 0.1 day by the desk). */
  function historyText(days) {
    if (!num(days)) return null;
    if (days < 1) { var hrs = Math.max(1, Math.round(days * 24)); return hrs + (hrs === 1 ? " hour" : " hours"); }
    return (Math.round(days * 10) / 10) + (Math.round(days * 10) / 10 === 1 ? " day" : " days");
  }
  function partialText(days) {
    var t = historyText(days);
    return t ? "Only " + t + " of history — showing all available" : "Not enough history for this range — showing all available";
  }

  /* Gap spans in the PLOTTED data: two neighbouring points further apart than 1.5 buckets means buckets with no recorded row.
     The line is not drawn across them (derived from the payload's own spacing; the desk's own count is `gaps`). */
  function gapSpans(points, bucket) {
    var out = [];
    if (!num(bucket) || bucket <= 0) return out;
    for (var i = 1; i < points.length; i++) {
      if (points[i].t - points[i - 1].t > bucket * 1.5) out.push([points[i - 1].t, points[i].t]);
    }
    return out;
  }

  /* What the chart can honestly say about recording pauses. `deskGaps` = the desk's own count of pauses over 5 min between two balance
     rows in the range (payload `gaps`); `spans` = the breaks the chart can place (a whole bucket without data, i.e. a hole > 1.5 buckets).
     A pause shorter than that sits inside one bucket's resolution: it cannot be located, so the line between neighbouring buckets may
     bridge it. We say so instead of implying continuous history. */
  function bucketLabel(s) { return !num(s) ? null : s >= 3600 ? (s / 3600) + " h" : s >= 60 ? Math.round(s / 60) + " min" : s + " s"; }
  function gapModel(m) {
    var desk = m && num(m.gaps) ? m.gaps : null, drawn = m && m.spans ? m.spans.length : 0, b = bucketLabel(m && m.bucket_s);
    var g = { desk: desk, drawn: drawn, bucket: b, unplaced: desk !== null && desk > 0 && desk > drawn, note: null, caption: "" };
    if (desk === null || desk === 0) return g;
    g.caption = desk + " recording pause" + (desk === 1 ? "" : "s") + " over 5 min in the desk's records for this range; " +
      (drawn ? drawn + " break" + (drawn === 1 ? "" : "s") + " drawn (shaded, the line stops there)." : "none is long enough to be drawn at this zoom.");
    if (g.unplaced) {
      g.note = "Recording pauses: the desk logged " + desk + " over 5 min in this range" + (b ? ", but this chart uses " + b + " buckets" : "") + ". " +
        (drawn ? "Breaks are drawn only where a whole bucket has no data; the rest" : "They") + " cannot be located at this zoom, so the line may bridge missing minutes. 24H has the finest detail.";
    }
    return g;
  }

  /* One model per tab. bag = DeskApp.X.chart (payloads by Worker key: 1D, 1W, ALL). */
  function rangeModel(tabId, bag) {
    var tab = tabById(tabId), p = bag && bag[tab.key];
    var m = { tab: tab, state: "loading", reason: null, points: [], marks: [], summary: null, bucket_s: null, gaps: null, base: null,
              partial: false, partialNote: null, coverageKnown: false, coverage_days: null, history_days: null, showsAll: false, since: null, first_ts: null, window: tab.id };
    if (!p || typeof p !== "object") return m;
    var pts = p.points, summary = p.summary, since = num(p.since) ? p.since : null, bucket = p.bucket_s, gaps = p.gaps;
    m.history_days = num(p.history_days) ? p.history_days : null;
    m.first_ts = num(p.first_ts) ? p.first_ts : null;
    if (tab.win30) {
      var w = p.window_30d;
      if (!w || typeof w !== "object") { m.state = "unavailable"; m.reason = "no-window-30d"; return m; }
      var hd = first(w.history_days, p.history_days);
      if (w.uses === "own") {
        if (!Array.isArray(w.points) || !w.summary) { m.state = "unavailable"; m.reason = "own-without-points"; return m; }
        pts = w.points; summary = w.summary; since = num(w.since) ? w.since : null; bucket = w.bucket_s; gaps = w.gaps;
        m.coverageKnown = true; m.coverage_days = num(w.coverage_days) ? w.coverage_days : null; m.partial = w.partial === true;
        if (m.partial) m.partialNote = partialText(m.coverage_days);
      } else if (w.uses === "all") {
        // ALL must never pass for a true 30-day chart: only legitimate while fewer than 30 days exist
        if (num(hd) && hd > 30) { m.state = "unavailable"; m.reason = "all-while-over-30d"; return m; }
        m.showsAll = true; m.partial = true; m.coverageKnown = true; m.coverage_days = first(w.coverage_days, w.history_days);
        m.partialNote = partialText(m.coverage_days);
      } else { m.state = "unavailable"; m.reason = "unknown-uses"; return m; }
    } else if (typeof p.partial === "boolean") {
      m.coverageKnown = true; m.partial = p.partial; m.coverage_days = num(p.coverage_days) ? p.coverage_days : null;
      if (m.partial) m.partialNote = partialText(first(p.coverage_days, p.history_days));
    }
    m.points = cleanPoints(pts);
    m.bucket_s = num(bucket) ? bucket : null;
    m.gaps = num(gaps) ? gaps : null;
    m.since = since;
    m.summary = summary && typeof summary === "object" ? summary : null;
    m.base = first(m.summary && m.summary.start_stack, p.start_value);
    var marks = Array.isArray(p.marks) ? p.marks.filter(function (x) { return x && num(x.t); }) : [];
    if (m.points.length) {
      var lo = m.points[0].t, hi = m.points[m.points.length - 1].t + (m.bucket_s || 0);
      marks = marks.filter(function (x) { return x.t >= lo && x.t <= hi; });
    }
    m.marks = marks;
    m.spans = gapSpans(m.points, m.bucket_s);
    m.state = m.points.length >= 2 ? "ready" : "empty";
    return m;
  }

  /* y value of a point: "usd" = equity, "pct" = P&L % against the simulated start stack. */
  function yOf(v, mode, base) {
    if (mode === "pct") return num(base) && base > 0 ? (v / base - 1) * 100 : null;
    return v;
  }
  /* Equity versus the simulated start stack (plain arithmetic on two payload numbers). */
  function pnlVs(v, base) {
    if (!num(v) || !num(base) || base <= 0) return { usd: null, pct: null };
    return { usd: round2(v - base), pct: Math.round((v / base - 1) * 1e6) / 1e4 };   /* pct keeps 4 decimals so the one-decimal display rounds once, from the true value */
  }
  /* Marks (BUY/SELL) that fall inside the bucket of a point. */
  function marksNear(m, pt) {
    if (!pt) return [];
    var span = m.bucket_s || 60;
    return m.marks.filter(function (x) { return x.t >= pt.t && x.t < pt.t + span; });
  }

  /* ---- balance hero: pulse.paper (5 s) first, portfolio (30 s) second, state last; each field only if the payload has it ---- */
  function heroModel(D, M, now) {
    D = D || {}; M = M || {}; now = now || Date.now();
    var paper = D.pulse && D.pulse.paper && typeof D.pulse.paper === "object" && num(D.pulse.paper.balance) ? D.pulse.paper : null;
    var P = D.portfolio, S = D.state, h = { source: null, balance: null, start: null, pnl_usd: null, pnl_pct: null, realized: null, unrealized: null, open_count: null };
    if (paper) {
      h.source = "pulse"; h.balance = paper.balance; h.start = first(paper.start_stack); h.pnl_usd = first(paper.pnl_usd); h.pnl_pct = first(paper.pnl_pct);
      h.realized = first(paper.realized_pnl_usd); h.unrealized = first(paper.unrealized_pnl_usd); h.open_count = first(paper.open_count);
    } else if (P) {
      h.source = "portfolio"; h.balance = first(P.balance); h.start = first(P.start_stack); h.pnl_usd = first(P.total_pnl_usd); h.pnl_pct = first(P.total_return_pct);
      h.realized = first(P.realized_pnl_usd); h.unrealized = first(P.unrealized_pnl_usd); h.open_count = P.counts ? first(P.counts.open) : null;
    } else if (S) {
      h.source = "state"; h.balance = first(S.balance); h.start = first(S.start_value);
      if (num(h.balance) && num(h.start)) { h.pnl_usd = round2(h.balance - h.start); h.pnl_pct = h.start ? round2((h.balance / h.start - 1) * 100) : null; }
    }
    var snap = S && S.health && S.health.snapshot_at ? Date.parse(S.health.snapshot_at) : NaN;
    h.asOf = isFinite(snap) ? snap : null;
    h.ageMs = h.asOf === null ? null : Math.max(0, now - h.asOf);
    var pm = M.pulse || {};
    h.stale = (h.ageMs !== null && h.ageMs > STALE_AFTER_MS) || (!!pm.error && pm.error !== "unavailable" && !!h.source);
    return h;
  }

  /* ---- open positions: portfolio rows (names, entry, stop, estimates) with the 5 s pulse.paper values laid over them by position id ---- */
  function openRows(P, paper) {
    var rows = P && Array.isArray(P.open) ? P.open : null;
    var pOpen = paper && Array.isArray(paper.open) ? paper.open : null;
    if (!rows && !pOpen) return null;
    var byId = {};
    (rows || []).forEach(function (r) { byId[r.id] = r; });
    var order = pOpen ? pOpen.map(function (x) { return x.id; }) : rows.map(function (r) { return r.id; });
    var pulseBy = {};
    (pOpen || []).forEach(function (x) { pulseBy[x.id] = x; });
    return order.map(function (id) {
      var r = byId[id] || null, l = pulseBy[id] || null, o = {};
      o.id = id; o.mint = (r && r.mint) || (l && l.mint) || null;
      o.name = r ? r.name : null; o.symbol = r ? r.symbol : null; o.known = !!r;
      o.value = first(l && l.value_usd, r && r.value_usd);
      o.cost = first(l && l.cost_usd, r && r.cost_usd);
      o.unrealized = first(l && l.unrealized_usd, r && r.unrealized_usd, r && r.pnl_usd);
      o.unrealized_pct = first(l && l.unrealized_pct, r && r.pnl_pct);
      o.priced = l && typeof l.priced === "boolean" ? l.priced : (r && typeof r.priced === "boolean" ? r.priced : null);
      o.price_at = (l && l.price_at) || (r && r.last_price_at) || null;
      o.est_exit_fee = first(r && r.est_exit_fee_usd);
      o.est_net = first(r && r.est_net_if_closed_usd);
      o.est_basis = r && typeof r.est_basis === "string" ? r.est_basis : null;
      o.size = first(r && r.size_usd); o.held_min = first(r && r.held_min); o.entry_price = first(r && r.entry_price); o.last_price = first(r && r.last_price);
      o.stop_price = first(r && r.stop_price); o.trail = r ? !!r.trail_active : null; o.opened_at = r ? r.opened_at : null; o.row = r;
      return o;
    });
  }

  function heldText(min) {
    if (!num(min)) return null;
    if (min < 60) return Math.round(min) + "m";
    var h = Math.floor(min / 60), m = Math.round(min - h * 60);
    return h + "h " + m + "m";
  }

  /* Threshold for "insufficient data": the desk's own number (portfolio.sample.min_for_stats); missing = treat as insufficient. */
  function sampleModel(P) {
    var n = P && P.counts ? P.counts.closed : null, s = P && P.sample || {};
    var min = num(s.min_for_stats) ? s.min_for_stats : null;
    return { closed: n, min: min, insufficient: !(num(n) && min !== null && n >= min), note: s.note || null };
  }

  window.DeskAdv = { TABS: TABS, NA: NA, STALE_AFTER_MS: STALE_AFTER_MS, tabById: tabById, rangeModel: rangeModel, yOf: yOf, pnlVs: pnlVs, marksNear: marksNear,
                     heroModel: heroModel, openRows: openRows, heldText: heldText, sampleModel: sampleModel, historyText: historyText, partialText: partialText,
                     gapSpans: gapSpans, gapModel: gapModel, bucketLabel: bucketLabel, num: num, first: first };
})();
