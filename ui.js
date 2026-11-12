/* X4rax Desk UI kit: agent icon badge, flow stepper, link indicator, splash timing.
   Presentation only. No network, no storage, no tokens, no API data inserted as HTML
   (createElement / createElementNS / textContent only). Icons are drawn from the
   <symbol> sprite in index.html. */
(function () {
  "use strict";
  var SVG_NS = "http://www.w3.org/2000/svg";

  /* The six agents. main is shown as the Conductor; the other five match the desk's real agent names. */
  var AGENTS = [
    { name: "main", label: "Conductor", role: "Runs and coordinates the five agents" },
    { name: "scanner", label: "Scanner", role: "Watches new graduations for candidates" },
    { name: "auditor", label: "Auditor", role: "Takes each coin apart in 8 checks" },
    { name: "analyst", label: "Analyst", role: "Scores the survivors" },
    { name: "executor", label: "Executor", role: "Simulates the PAPER entry" },
    { name: "risk", label: "Risk", role: "Guards stops and trailing exits" }
  ];
  var BY_NAME = {};
  AGENTS.forEach(function (a) { BY_NAME[a.name] = a; });

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", cls || "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  /* Agent badge: tinted, glowing rounded square with the agent's icon and a status dot.
     size: "sm" | "md" | "lg". status: "running" | "stale" | "paused" | "idle". */
  function agentBadge(name, size, status) {
    var span = document.createElement("span");
    span.className = "agent-badge agent-" + size_(size);
    span.setAttribute("data-agent", name);
    span.setAttribute("data-status", status || "idle");
    span.appendChild(icon(BY_NAME[name] ? name : "main"));
    var dot = document.createElement("i");
    dot.className = "agent-dot";
    span.appendChild(dot);
    return span;
  }
  /* Status vocabulary shown by a badge (data-status): the desk's six agent states (idle, scanning, analyzing,
     processing, waiting, error) plus what the app itself can tell: stale (heartbeat too old), stalled (the desk flagged it),
     paused, unknown (nothing reported yet). "running" is the older heartbeat-only value. */
  function setBadgeStatus(badge, status) { if (badge) badge.setAttribute("data-status", status || "unknown"); }

  function size_(s) { return s === "sm" || s === "lg" ? s : "md"; }

  /* A row: badge + label + role (used by stub rosters). */
  function agentRow(a) {
    var li = document.createElement("li");
    li.className = "agent-row";
    li.setAttribute("data-agent", a.name);
    li.appendChild(agentBadge(a.name, "md"));
    var txt = document.createElement("div");
    txt.className = "agent-txt";
    var n = document.createElement("strong");
    n.textContent = a.label;
    var r = document.createElement("span");
    r.textContent = a.role;
    txt.appendChild(n);
    txt.appendChild(r);
    li.appendChild(txt);
    return li;
  }

  function fillRoster(ul) {
    ul.replaceChildren.apply(ul, AGENTS.map(agentRow));
  }

  /* Compact row of six badges (pairing screen). */
  function fillBadgeStrip(ul) {
    ul.replaceChildren.apply(ul, AGENTS.map(function (a) {
      var li = document.createElement("li");
      li.setAttribute("title", a.label);
      li.appendChild(agentBadge(a.name, "sm"));
      return li;
    }));
  }

  var STEPS = ["FOMO", "Start-up", "Pipeline", "Dashboard"];
  function fillStepper(nav) {
    var active = Number(nav.getAttribute("data-step")) || 1;
    var items = STEPS.map(function (label, i) {
      var s = document.createElement("span");
      s.className = "step" + (i + 1 < active ? " is-done" : "") + (i + 1 === active ? " is-active" : "");
      if (i + 1 === active) s.setAttribute("aria-current", "step");
      var dot = document.createElement("i");
      var t = document.createElement("em");
      t.textContent = label;
      s.appendChild(dot);
      s.appendChild(t);
      return s;
    });
    nav.replaceChildren.apply(nav, items);
  }

  /* Link indicator: state is what the poller actually saw. */
  var LINK_TEXT = { idle: "not connected", live: "live", stale: "stale", offline: "offline" };
  function setLink(state) {
    var s = LINK_TEXT[state] ? state : "idle";
    var dot = document.getElementById("link-dot");
    var txt = document.getElementById("link-text");
    if (dot) {
      dot.setAttribute("data-state", s);
      dot.setAttribute("aria-label", "Desk link: " + LINK_TEXT[s]);
    }
    if (txt) txt.textContent = LINK_TEXT[s];
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* Splash: ~2s of animation (CSS), then fade-out. Returns a cancel function.
     Tap/click skips. Reduced motion shortens the hold to 0.9s with no animation. */
  var SPLASH_MS = 2000;
  var SPLASH_REDUCED_MS = 900;
  var LEAVE_MS = 260;
  function runSplash(section, done) {
    var finished = false;
    var t1 = null, t2 = null;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(t1);
      clearTimeout(t2);
      section.removeEventListener("click", skip);
      done();
    }
    function skip() {
      if (finished) return;
      section.classList.add("is-leaving");
      clearTimeout(t1);
      t2 = setTimeout(finish, reducedMotion() ? 0 : 140);
    }
    section.addEventListener("click", skip);
    section.classList.remove("is-leaving");
    section.classList.add("is-playing");
    t1 = setTimeout(function () {
      section.classList.add("is-leaving");
      t2 = setTimeout(finish, reducedMotion() ? 0 : LEAVE_MS);
    }, reducedMotion() ? SPLASH_REDUCED_MS : SPLASH_MS);
    return function cancel() { finished = true; clearTimeout(t1); clearTimeout(t2); };
  }

  /* ---------- tiny DOM + formatting helpers (textContent only; no HTML strings anywhere) ---------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) { if (arguments[i]) parent.appendChild(arguments[i]); }
    return parent;
  }
  function svgEl(tag, attrs, cls) {
    var e = document.createElementNS(SVG_NS, tag);
    if (cls) e.setAttribute("class", cls);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function ico(name, cls) { return icon(name, cls || "icon"); }

  var SUB = "₀₁₂₃₄₅₆₇₈₉";
  function num(n) { return typeof n === "number" && isFinite(n); }
  function money(n, d) {
    if (!num(n)) return "—";
    var a = Math.abs(n);
    var s = a.toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
    return (n < 0 ? "-$" : "$") + s;
  }
  function signed(n, d) {
    if (!num(n)) return "—";
    return (n > 0 ? "+" : n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
  }
  function pct(n, d) {
    if (!num(n)) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(d === undefined ? 1 : d) + "%";
  }
  function compact(n) {
    if (!num(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(0);
  }
  /* Token prices span many magnitudes: 1.58, 0.0421, 0.0₄2852 (four zeros after the point). */
  function price(n) {
    if (!num(n)) return "—";
    if (n === 0) return "$0";
    var a = Math.abs(n);
    if (a >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (a >= 1) return "$" + n.toFixed(a >= 100 ? 2 : 3);
    if (a >= 0.01) return "$" + n.toFixed(4);
    var zeros = Math.floor(-Math.log10(a)) - 1;
    if (zeros < 3) return "$" + n.toFixed(zeros + 4);
    var digits = (a * Math.pow(10, zeros + 1)).toFixed(4).replace(".", "").slice(0, 4).replace(/0+$/, "") || "0";
    var sub = String(zeros).split("").map(function (d) { return SUB.charAt(Number(d)); }).join("");
    return "$0.0" + sub + digits;
  }
  function ago(ms) {
    if (!num(ms) || ms < 0) return "—";
    var s = Math.round(ms / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var hr = Math.floor(m / 60);
    if (hr < 48) return hr + "h " + (m % 60) + "m ago";
    return Math.floor(hr / 24) + "d ago";
  }
  function agoIso(iso, now) {
    var t = Date.parse(iso);
    return isNaN(t) ? "—" : ago((now || Date.now()) - t);
  }
  function clock(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function tone(n) { return !num(n) || n === 0 ? "flat" : n > 0 ? "up" : "down"; }

  /* Source labels, so market data, simulation and demonstration data are never confused. */
  var SOURCE_TEXT = { market: "MARKET DATA", sim: "SIMULATION", demo: "DEMO", desk: "DESK STATUS", wallet: "READ-ONLY" };
  function srcTag(kind) {
    var e = h("span", "src-tag src-" + kind, SOURCE_TEXT[kind] || kind);
    return e;
  }
  function chip(text, tn) { return h("span", "chip chip-" + (tn || "flat"), text); }

  /* Horizontal bar drawn as SVG (no inline styles under the CSP). pct 0..100. */
  function bar(p, tn) {
    var v = Math.max(0, Math.min(100, num(p) ? p : 0));
    var svg = svgEl("svg", { viewBox: "0 0 100 4", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" }, "bar bar-" + (tn || "brand"));
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 100, height: 4, rx: 2 }, "bar-bg"));
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: v, height: 4, rx: 2 }, "bar-fg"));
    return svg;
  }
  /* A row of n segments (Auditor layers): states[i] in pass | fail | pending | active. */
  function segments(states) {
    var wrap = h("span", "segs");
    wrap.setAttribute("role", "img");
    var ok = states.filter(function (x) { return x === "pass"; }).length;
    wrap.setAttribute("aria-label", ok + " of " + states.length + " checks passed");
    states.forEach(function (st) { wrap.appendChild(h("i", "seg seg-" + st)); });
    return wrap;
  }
  function empty(iconName, title, text) {
    var box = h("div", "empty");
    var halo = h("span", "empty-halo");
    halo.appendChild(ico(iconName || "main"));
    add(box, halo, h("strong", "empty-title", title), h("p", "empty-text", text));
    return box;
  }
  function skeleton(lines) {
    var sk = h("div", "skeleton");
    sk.setAttribute("aria-hidden", "true");
    for (var i = 0; i < (lines || 3); i++) sk.appendChild(h("i"));
    return sk;
  }
  /* Replace the children of `box` only when `sig` changed (avoids re-running entrance animations every poll). */
  function memo(box, sig, build) {
    if (box.__sig === sig) return false;
    box.__sig = sig;
    var kids = build();
    box.replaceChildren.apply(box, kids || []);
    return true;
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("nav.stepper"), fillStepper);
    Array.prototype.forEach.call(document.querySelectorAll("ul[data-roster]"), fillRoster);
    var strip = document.getElementById("pair-roster");
    if (strip) fillBadgeStrip(strip);
  }
  init();

  window.DeskUI = {
    AGENTS: AGENTS,
    agentBadge: agentBadge,
    setLink: setLink,
    runSplash: runSplash,
    reducedMotion: reducedMotion,
    setBadgeStatus: setBadgeStatus,
    icon: ico, h: h, add: add, svgEl: svgEl,
    fmt: { money: money, signed: signed, pct: pct, compact: compact, price: price, ago: ago, agoIso: agoIso, clock: clock, tone: tone, num: num },
    srcTag: srcTag, chip: chip, bar: bar, segments: segments, empty: empty, skeleton: skeleton, memo: memo
  };
})();
