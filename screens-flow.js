/* Start-up flow screens: #fomo (read-only FOMO + public wallet), #init (six agents come online), #pipeline (the six-agent flow).
   Everything shown comes from the Worker payloads held by DeskApp (state, pulse, wallet, decisions). Nothing is timer-faked:
   an agent is "online" only while its own heartbeat is fresh, progress bars exist only where the agent reported progress,
   and a payload the Worker does not have yet is shown as "unavailable", never filled in. DOM built with textContent only. */
(function () {
  "use strict";
  var A = window.DeskApp, UI = window.DeskUI;
  var h = UI.h, add = UI.add, f = UI.fmt;
  var ORDER = ["main", "scanner", "auditor", "analyst", "executor", "risk"];
  var ROLE = { main: "Overall coordination", scanner: "Memecoin discovery", auditor: "Token safety checks",
               analyst: "Market and wallet analysis", executor: "Simulated trade execution", risk: "Exposure and risk management" };
  var STATE_TEXT = { scanning: "Scanning", analyzing: "Analyzing", processing: "Processing", idle: "Idle", waiting: "Waiting",
                     error: "Error", stale: "No heartbeat", stalled: "Stalled", paused: "Paused", unknown: "No data yet", running: "Online" };
  var ACTIVE = { scanning: 1, analyzing: 1, processing: 1 };

  function sourceTags(kind) {
    var wrap = h("span", "tags");
    add(wrap, UI.srcTag(kind));
    if (A.isDemo()) add(wrap, UI.srcTag("demo"));
    return wrap;
  }
  function D() { return A.D(); }
  function M() { return A.M(); }

  /* ================================================================ #fomo */
  var fomoBox = document.getElementById("fomo-body");

  function linkStatus() {
    var m = M().state || {};
    if (m.error === "offline") return ["Offline", "bad"];
    if (m.error) return ["Unavailable (" + m.status + ")", "bad"];
    var s = D().state;
    if (!s) return ["Connecting…", "flat"];
    var hb = s.heartbeats ? Object.keys(s.heartbeats).map(function (k) { return Date.parse(s.heartbeats[k]); }).filter(isFinite) : [];
    var newest = hb.length ? Math.max.apply(null, hb) : NaN;
    if (isFinite(newest) && Date.now() - newest > A.STALE_MS) return ["Stale", "warn"];
    return ["Live", "up"];
  }

  function statusRow(label, chipEl, text) {
    var li = h("li", "status-row");
    add(li, h("span", "status-label", label), chipEl, text ? h("p", "status-text", text) : null);
    return li;
  }

  function fomoCards() {
    var d = D(), fomo = (d.state && d.state.fomo) || null, w = d.wallet, wm = M().wallet || {};
    var handle = fomo && typeof fomo.handle === "string" ? fomo.handle.replace(/^@/, "") : "";
    var link = linkStatus();
    var cards = [];

    var hero = h("section", "glow-card fomo-hero");
    var av = h("div", "fomo-avatar");
    add(av, h("span", "fomo-initial", handle ? handle.charAt(0).toUpperCase() : "?"), h("i", "fomo-ring"), h("i", "fomo-ring fomo-ring-2"));
    var who = h("div", "fomo-who");
    add(who, h("p", "eyebrow", "FOMO account"), h("h3", "fomo-handle", handle ? "@" + handle : "Handle not provided"),
        h("p", "fomo-sub", handle ? "From your desk settings (fomo_handle)" : "This desk version did not send a handle"));
    add(hero, add(h("div", "fomo-head"), av, who));
    var list = h("ul", "status-list");
    add(list, statusRow("Desk link", UI.chip(link[0], link[1]), null));
    add(list, statusRow("FOMO", UI.chip("Read-only", "info"),
      "FOMO offers no API, so this app cannot check or connect to your FOMO account. Nothing here is a login or a connection to FOMO."));
    var wChip = w && w.configured ? UI.chip(w.balance_sol === null ? "Balance unavailable" : "Balance read", w.balance_sol === null ? "warn" : "up") : UI.chip(wm.unavailable ? "Not synced yet" : "Not set", "flat");
    add(list, statusRow("Public wallet", wChip, null));
    add(hero, list);
    cards.push(hero);

    var wc = h("section", "card wallet-card");
    add(wc, add(h("div", "card-head"), h("h3", null, "Public Solana wallet"), sourceTags("wallet")));
    if (!w) {
      add(wc, wm.unavailable
        ? UI.empty("wallet", "Wallet data isn't available yet", "The desk's cloud Worker has not been upgraded to carry the wallet balance. Everything else works; nothing is estimated in its place.")
        : UI.skeleton(3));
    } else if (!w.configured) {
      add(wc, UI.empty("wallet", "No wallet set (optional)",
        "Your desk can show the SOL balance of one PUBLIC wallet address. Set it on the desk, not here: the app is read-only. On the desk run: python3 tools/set_wallet.py set <PUBLIC_ADDRESS>. Only a public address is accepted; anything that looks like a secret key or recovery phrase is refused."));
    } else {
      var bal = h("div", "wallet-balance");
      var big = h("strong", "wallet-sol", w.balance_sol === null ? "—" : w.balance_sol.toLocaleString("en-US", { maximumFractionDigits: 4 }));
      add(bal, big, h("span", "wallet-unit", "SOL"));
      var addr = h("p", "wallet-addr");
      addr.setAttribute("title", w.address || "");
      addr.textContent = w.address || "";
      var meta = h("p", "wallet-meta");
      if (w.balance_sol === null) {
        meta.textContent = "The desk could not read the balance" + (w.error ? " (" + w.error + ")" : "") + ". It will retry; no number is shown until it can.";
      } else {
        meta.textContent = "Read from Solana's public RPC " + f.agoIso(w.fetched_at) + " · public address only";
      }
      add(wc, bal, addr, meta);
    }
    cards.push(wc);

    var pc = h("section", "card perms");
    add(pc, add(h("div", "card-head"), h("h3", null, "What this app can and can't do")));
    var cols = h("div", "perm-cols");
    function col(title, ok, items) {
      var c = h("div", "perm-col " + (ok ? "perm-can" : "perm-cant"));
      add(c, h("h4", null, title));
      var ul = h("ul");
      items.forEach(function (t) {
        var li = h("li");
        add(li, UI.icon(ok ? "check" : "x", "icon perm-ico"), h("span", null, t));
        ul.appendChild(li);
      });
      return add(c, ul);
    }
    add(cols, col("Can", true, ["Read the desk's status and the PAPER (simulated) portfolio", "Show market data the desk collected", "Show the balance of a public wallet address", "Open FOMO pages in your browser"]),
        col("Can't", false, ["Sign anything, or hold secret keys or a recovery phrase", "Send, swap or approve transactions", "Place orders: real, LIVE, or on FOMO", "Change the desk's mode or settings (PAPER only)"]));
    add(pc, cols, h("p", "perm-foot", "PAPER mode only. LIVE trading is disabled and not implemented."));
    cards.push(pc);
    return cards;
  }

  A.register("fomo", {
    enter: function () { update(); },
    update: update
  });
  function update() {
    var d = D(), w = d.wallet;
    var sig = JSON.stringify([d.state && d.state.fomo && d.state.fomo.handle, w, (M().wallet || {}).unavailable, linkStatus(), Math.floor(Date.now() / 20000), A.isDemo()]);
    UI.memo(fomoBox, sig, fomoCards);
  }

  /* ================================================================ #init */
  var initBox = document.getElementById("init-body");
  var initRefs = null;

  function initView(av) {
    var s = av.status;
    if (s === "unknown") return { cls: "is-unknown", text: "Waiting for the first heartbeat…", sub: "" };
    var hb = isFinite(av.hbAge) ? "heartbeat " + f.ago(av.hbAge) : "no heartbeat reported";
    if (s === "stale") return { cls: "is-stale", text: "No heartbeat for " + f.ago(av.hbAge).replace(" ago", ""), sub: "Last seen " + f.ago(av.hbAge) };
    if (s === "error") return { cls: "is-bad", text: "Error", sub: (av.pa && av.pa.last_error) || (av.pa && av.pa.task) || "" };
    if (s === "stalled") return { cls: "is-bad", text: "Stalled", sub: "The desk flagged this agent as not responding · " + hb };
    if (s === "paused") return { cls: "is-wait", text: "Online · paused", sub: hb };
    if (s === "waiting") return { cls: "is-wait", text: "Online · waiting", sub: (av.pa && av.pa.task ? av.pa.task + " · " : "") + hb };
    if (s === "running") return { cls: "is-online", text: "Online", sub: hb + " (heartbeat only)" };
    return { cls: "is-online", text: "Online · " + (STATE_TEXT[s] || s).toLowerCase(), sub: (av.pa && av.pa.task ? av.pa.task + " · " : "") + hb };
  }

  function buildInit() {
    var sum = h("section", "glow-card init-summary");
    var ring = h("div", "init-ring");
    var count = h("strong", "init-count", "0/6");
    add(ring, count, h("span", null, "online"));
    var txt = h("div", "init-sum-text");
    var t1 = h("h3", null, "Waiting for the desk…");
    var t2 = h("p", null, "An agent lights up only while its own heartbeat is fresh (under 2 minutes). Nothing here runs on a timer.");
    var src = h("p", "init-src");
    add(txt, t1, t2, src);
    add(sum, ring, txt);
    var list = h("ol", "init-list");
    list.setAttribute("aria-label", "The six agents");
    var rows = {};
    ORDER.forEach(function (n, i) {
      var li = h("li", "init-row is-unknown");
      li.setAttribute("data-agent", n);
      li.classList.add("enter-" + i);
      var badge = UI.agentBadge(n, "md", "unknown");
      var body = h("div", "init-txt");
      var name = h("strong", null, UI.AGENTS[i].label), role = h("span", "init-role", ROLE[n]);
      var st = h("span", "init-state", ""), sub = h("span", "init-sub", "");
      add(body, name, role, st, sub);
      var lamp = h("span", "init-lamp");
      lamp.appendChild(UI.icon("check", "icon"));
      add(li, badge, body, lamp);
      list.appendChild(li);
      rows[n] = { li: li, badge: badge, st: st, sub: sub };
    });
    var note = h("p", "init-note");
    initRefs = { count: count, t1: t1, t2: t2, src: src, ring: ring, rows: rows, note: note };
    initBox.replaceChildren(sum, list, note);
  }

  function updateInit() {
    if (!initRefs) buildInit();
    var r = initRefs, online = 0, bad = 0;
    ORDER.forEach(function (n) {
      var av = A.agentView(n), v = initView(av), row = r.rows[n];
      row.li.className = "init-row " + v.cls + " enter-" + ORDER.indexOf(n);
      UI.setBadgeStatus(row.badge, av.status);
      row.st.textContent = v.text;
      row.sub.textContent = v.sub;
      if (v.cls === "is-online" || v.cls === "is-wait") online++;
      if (v.cls === "is-bad") bad++;
    });
    r.count.textContent = online + "/6";
    r.ring.setAttribute("data-level", online === 6 ? "all" : online === 0 ? "none" : "some");
    var hasData = !!D().state || !!D().pulse;
    r.t1.textContent = !hasData ? "Waiting for the desk…" : online === 6 ? "All six agents are online" : bad ? bad + " agent" + (bad > 1 ? "s" : "") + " reporting a problem" : online + " of 6 agents online";
    var pm = M().pulse || {};
    r.src.textContent = pm.unavailable ? "Detailed agent status is not available from the Worker yet. Only heartbeats are shown." :
      pm.at ? "Agent status from the desk, fetched " + f.ago(Date.now() - pm.at) : "";
    r.note.textContent = A.isDemo() ? "DEMO data: these agents are synthetic and are not your desk." : "";
  }
  A.register("init", { enter: updateInit, update: updateInit });

  /* ================================================================ #pipeline */
  var pipeBox = document.getElementById("pipeline-body");
  var pipeRefs = null;
  var openNode = "";

  function parseProgress(av) {
    var task = (av.pa && av.pa.task) || "";
    var m;
    if (av.name === "scanner" && (m = /room (\d+)\/(\d+)/.exec(task))) {
      var n = Number(m[1]), tot = Number(m[2]);
      return { kind: "bar", pct: tot ? (n / tot) * 100 : 0, label: n + " of " + tot + " coins in the waiting room checked" };
    }
    if (av.name === "auditor" && (m = /layer (\d)\/8/.exec(task))) {
      var cur = D().state && Array.isArray(D().state.agents) ? D().state.agents.filter(function (a) { return a && a.name === "auditor"; })[0] : null;
      var strips = cur && cur.current && Array.isArray(cur.current.strips) && cur.current.strips.length === 8 ? cur.current.strips : null;
      if (strips) return { kind: "segs", segs: strips, label: "Layer " + m[1] + " of 8 · " + strips.filter(function (x) { return x === "pass"; }).length + " passed so far" };
      return { kind: "bar", pct: (Number(m[1]) / 8) * 100, label: "Layer " + m[1] + " of 8" };
    }
    return null;
  }

  function pipeNode(n, i) {
    var li = h("li", "pipe-node enter-" + i);
    li.setAttribute("data-agent", n);
    var head = h("button", "pipe-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    var badge = UI.agentBadge(n, "lg", "unknown");
    var mid = h("span", "pipe-mid");
    var name = h("strong", "pipe-name", UI.AGENTS[i].label);
    var role = h("span", "pipe-role", ROLE[n]);
    var chipWrap = h("span", "pipe-state");
    var lamp = h("i", "lamp");
    var stText = h("span", "pipe-state-text", "");
    add(chipWrap, lamp, stText);
    add(mid, name, role, chipWrap);
    var chev = h("span", "pipe-chev");
    chev.appendChild(UI.icon("back", "icon"));
    add(head, badge, mid, chev);
    var task = h("p", "pipe-task", "");
    var prog = h("div", "pipe-prog");
    var metrics = h("div", "pipe-metrics");
    var beat = h("p", "pipe-beat", "");
    var more = h("div", "pipe-more");
    more.hidden = true;
    add(li, head, task, prog, metrics, beat, more);
    head.addEventListener("click", function () {
      var on = openNode !== n;
      openNode = on ? n : "";
      updatePipe();
      if (on && n !== "main") A.ensure("decisions", n, "/api/agents/" + n + "/decisions", 30000);
    });
    return { li: li, head: head, badge: badge, lamp: lamp, st: stText, task: task, prog: prog, metrics: metrics, beat: beat, more: more };
  }

  function buildPipe() {
    var head = h("div", "pipe-intro");
    var note = h("p", "pipe-note", "");
    var flowEl = h("ol", "pipe");
    flowEl.setAttribute("aria-label", "Agent pipeline: Conductor, Scanner, Auditor, Analyst, Executor, Risk");
    var nodes = {}, links = [];
    ORDER.forEach(function (n, i) {
      nodes[n] = pipeNode(n, i);
      flowEl.appendChild(nodes[n].li);
      if (i < ORDER.length - 1) {
        var link = h("li", "pipe-link");
        link.setAttribute("aria-hidden", "true");
        add(link, h("i", "pipe-dots"));
        flowEl.appendChild(link);
        links.push(link);
      }
    });
    pipeRefs = { head: head, note: note, nodes: nodes, links: links };
    add(head, h("p", "pipe-lead", "Conductor supervises; coins then move Scanner → Auditor → Analyst → Executor → Risk. Tap an agent for details."), sourceTags("desk"));
    pipeBox.replaceChildren(head, note, flowEl);
  }

  function counterChips(av) {
    var c = (av.pa && av.pa.counters) || {};
    return Object.keys(c).sort().map(function (k) { return UI.chip(k.replace(/_/g, " ") + " " + c[k], "flat"); });
  }

  function eventLine(ev) {
    var li = h("li", "ev-line");
    var txt = (ev.kind || "").replace(/_/g, " ") + (ev.coin ? " · " + ev.coin : "") + (ev.detail ? " · " + ev.detail : "");
    add(li, h("span", "ev-txt", txt), h("span", "ev-ago", f.agoIso(ev.ts)));
    return li;
  }

  function detailPanel(n, av) {
    var box = [];
    var pa = av.pa;
    var rows = h("dl", "kv");
    function kv(k, v) { if (v === null || v === undefined || v === "") return; add(rows, h("dt", null, k), h("dd", null, v)); }
    if (pa) {
      kv("State since", pa.since ? f.agoIso(pa.since) : null);
      kv("Last activity", pa.last_activity ? pa.last_activity + (pa.last_activity_at ? " · " + f.agoIso(pa.last_activity_at) : "") : "none recorded yet");
      kv("Queue", pa.queue_depth === null || pa.queue_depth === undefined ? null : pa.queue_depth + " waiting");
      kv("Desk health", pa.health);
      if (pa.last_error) kv("Last error", pa.last_error + (pa.last_error_at ? " · " + f.agoIso(pa.last_error_at) : ""));
    } else {
      kv("Status", "Only the heartbeat is available from the Worker (detailed status needs the desk upgrade).");
    }
    box.push(rows);
    var evs = D().pulse && Array.isArray(D().pulse.events) ? D().pulse.events.filter(function (e) { return e.agent === n; }).slice(0, 5) : [];
    box.push(h("h4", "more-h", "Recent activity"));
    if (evs.length) { var ul = h("ul", "ev-list"); evs.forEach(function (e) { ul.appendChild(eventLine(e)); }); box.push(ul); }
    else box.push(h("p", "muted", pa ? "Nothing recorded for this agent yet. It only logs real events, so a quiet agent stays quiet." : "No activity data available."));
    if (n !== "main") {
      box.push(h("h4", "more-h", "Latest decisions"));
      var dec = A.X.decisions[n], dm = A.XM["decisions:" + n] || {};
      if (dec && Array.isArray(dec.decisions) && dec.decisions.length) {
        var dl = h("ul", "ev-list");
        dec.decisions.slice(0, 5).forEach(function (d) {
          var li = h("li", "ev-line");
          add(li, h("span", "ev-txt", (d.verdict || "") + " · " + (d.coin || "coin") + (d.reason ? " · " + d.reason : "")), h("span", "ev-ago", f.agoIso(d.ts)));
          dl.appendChild(li);
        });
        box.push(dl);
      } else if (dm.unavailable) box.push(h("p", "muted", "Decision history is not available from the Worker yet."));
      else if (dm.at) box.push(h("p", "muted", "No decisions recorded for this agent yet."));
      else box.push(h("p", "muted", "Loading…"));
    }
    return box;
  }

  function updatePipe() {
    if (!pipeRefs) buildPipe();
    var r = pipeRefs, pm = M().pulse || {};
    r.note.textContent = pm.unavailable ? "Detailed agent status isn't available from the Worker yet: showing heartbeats only. It appears after the Worker and desk upgrade." :
      (D().pulse ? "" : (pm.error ? "Agent status is unavailable right now." : "Loading agent status…"));
    r.note.hidden = !r.note.textContent;
    var views = {};
    ORDER.forEach(function (n) { views[n] = A.agentView(n); });
    ORDER.forEach(function (n, i) {
      var av = views[n], nd = r.nodes[n], s = av.status;
      nd.li.setAttribute("data-status", s);
      UI.setBadgeStatus(nd.badge, s);
      nd.st.textContent = STATE_TEXT[s] || s;
      nd.lamp.setAttribute("data-status", s);
      var task = av.pa ? av.pa.task : (s === "unknown" ? "Waiting for the first report from the desk" : "Heartbeat only");
      nd.task.textContent = task || "";
      var p = parseProgress(av), sig = p ? JSON.stringify(p) : "";
      if (nd.prog.__sig !== sig) {
        nd.prog.__sig = sig;
        if (!p) nd.prog.replaceChildren();
        else if (p.kind === "bar") nd.prog.replaceChildren(UI.bar(p.pct, n), h("span", "prog-label", p.label));
        else nd.prog.replaceChildren(UI.segments(p.segs), h("span", "prog-label", p.label));
      }
      nd.prog.hidden = !p;
      var chips = counterChips(av);
      if (av.pa && av.pa.queue_depth) chips.unshift(UI.chip("queue " + av.pa.queue_depth, "info"));
      var msig = chips.map(function (c) { return c.textContent; }).join("|");
      if (nd.metrics.__sig !== msig) { nd.metrics.__sig = msig; nd.metrics.replaceChildren.apply(nd.metrics, chips); }
      nd.metrics.hidden = !chips.length;
      nd.beat.textContent = (isFinite(av.hbAge) ? "Heartbeat " + f.ago(av.hbAge) : "No heartbeat reported") +
        (av.pa && av.pa.last_activity_at ? " · last activity " + f.agoIso(av.pa.last_activity_at) : "");
      var open = openNode === n;
      nd.head.setAttribute("aria-expanded", open ? "true" : "false");
      nd.li.classList.toggle("is-open", open);
      nd.more.hidden = !open;
      if (open) {
        var dsig = JSON.stringify([av.pa, D().pulse && D().pulse.seq, A.X.decisions[n] && A.X.decisions[n].decisions && A.X.decisions[n].decisions.length, (A.XM["decisions:" + n] || {}).at, Math.floor(Date.now() / 10000)]);
        UI.memo(nd.more, dsig, function () { return detailPanel(n, av); });
      }
      if (i < ORDER.length - 1) {
        var link = r.links[i], from = views[n].status;
        link.setAttribute("data-flow", ACTIVE[from] ? "active" : (from === "error" || from === "stalled") ? "error" : "idle");
      }
    });
  }
  A.register("pipeline", { enter: updatePipe, update: updatePipe });
})();
