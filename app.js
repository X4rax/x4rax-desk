/* Desk front-end (PAPER). No secrets live in this file.
   Security notes:
   - The iPhone signs in with a per-device token obtained by typing a
     short-lived pairing code (POST /api/pair/redeem). The long-lived
     APP_TOKEN never enters Safari, the URL, or this file.
   - The device token is stored in localStorage and sent only as an
     Authorization Bearer header to the Worker. It is never placed in a
     URL or query string. Redeem happens over a JSON body; the token
     arrives in the response body (Cache-Control: no-store).
   - A leftover #t= fragment from an older sign-in flow is wiped and ignored.
   - The token is cleared on any 401, and by opening the app with #logout
     (which also calls POST /api/pair/revoke-self when possible).
   - API data is never inserted as HTML; only textContent is used. The
     pairing screen uses createElement / textContent / addEventListener;
     there is no <form> (CSP form-action is 'none').
   - API_BASE is the Cloudflare Worker origin (https://<worker>.workers.dev).
     index.html's Content-Security-Policy connect-src must allow that origin.
   - While signed in and visible, the app refreshes GET /api/state every
     15 seconds (one request per tick). Polling pauses completely when the
     page is hidden, frozen, or on the pairing screen. Overlapping fetches
     are skipped; each fetch is aborted after 10 seconds. Network errors
     back off 15s → 30s → 60s (cap) and reset to 15s on success.
   - If the newest heartbeat or the snapshot_at timestamp is more than
     two minutes old, a small banner (textContent only) shows
     "Desk data is stale since HH:MM".
   - FOMO links (profile, invite) are rendered only from the API payload
     (state.fomo). This file never builds a FOMO URL. A link is shown only
     if it is https and carries the referral code the payload names
     (link_ref). Each one has a caption (link_note) saying it only opens
     FOMO, the desk places no orders, and you trade there yourself. Links
     open with rel="noopener noreferrer"; text goes in with textContent. */
(function () {
  "use strict";
  var API_BASE = "https://x4rax-desk.riadh-ferjani02.workers.dev"; /* Cloudflare Worker origin */
  var KEY = "device_token";
  var TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
  var POLL_MS = 15000;
  var BACKOFF_CAP_MS = 60000;
  var FETCH_TIMEOUT_MS = 10000;
  var STALE_MS = 120000;
  var heartbeatsEl = document.getElementById("heartbeats");
  var modeEl = document.getElementById("mode");
  var staleBanner = null;
  var pairBox = null;
  var pollTimer = null;
  var inFlight = false;
  var abortCtl = null;
  var abortTimer = null;
  var backoffMs = POLL_MS;

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function clearToken() { store(function (s) { s.removeItem(KEY); }); }

  function wipeFragment() { history.replaceState(null, "", location.pathname + location.search); }

  function readFragment() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return "ok";
    if (raw === "logout") {
      var existing = token();
      wipeFragment();
      if (existing) revokeSelf(existing);
      clearToken();
      return "logout";
    }
    /* Older #t= private-link fragments: wipe and ignore. Never store them. */
    wipeFragment();
    return "ok";
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
    return isVisible() && !!token();
  }

  function stopTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function cancelFetch() {
    if (abortTimer !== null) {
      clearTimeout(abortTimer);
      abortTimer = null;
    }
    if (abortCtl) {
      try { abortCtl.abort(); } catch (e) {}
      abortCtl = null;
    }
  }

  function pausePolling() {
    stopTimer();
    cancelFetch();
  }

  function schedule(ms) {
    stopTimer();
    if (!canPoll()) return;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      if (!canPoll() || inFlight) return;
      refresh();
    }, ms);
  }

  function onHidden() {
    pausePolling();
  }

  function onWake() {
    if (!canPoll()) {
      stopTimer();
      if (!token()) showPairing("Enter the pairing code shown on the desk.");
      return;
    }
    /* Already running in the foreground: ignore a duplicate focus event. */
    if (inFlight || pollTimer !== null) return;
    refresh();
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

  function showStaleBanner(sinceMs) {
    var when = new Date(sinceMs);
    var hhmm = isNaN(when.getTime())
      ? ""
      : when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    var text = hhmm ? ("Desk data is stale since " + hhmm) : "Desk data is stale";
    if (!staleBanner) {
      staleBanner = document.createElement("p");
      staleBanner.id = "stale-banner";
      var header = document.querySelector("header") || document.querySelector("main") || document.body;
      header.appendChild(staleBanner);
    }
    staleBanner.textContent = text;
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
    if (isNaN(newest)) { hideStaleBanner(); return; }
    if (Date.now() - newest > STALE_MS) showStaleBanner(newest);
    else hideStaleBanner();
  }

  function showHeartbeats(hb) {
    if (!heartbeatsEl || !hb || typeof hb !== "object") return;
    var items = Object.keys(hb).sort().map(function (k) {
      var li = document.createElement("li");
      li.textContent = String(k) + " · " + String(hb[k]);
      return li;
    });
    heartbeatsEl.replaceChildren.apply(heartbeatsEl, items);
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

  function setPairStatus(text) {
    if (!pairBox) return;
    var status = pairBox.querySelector("#pair-status");
    if (status) status.textContent = text;
  }

  function hidePairing() {
    if (pairBox && pairBox.parentNode) pairBox.parentNode.removeChild(pairBox);
    pairBox = null;
  }

  function showPairing(message) {
    pausePolling();
    hideStaleBanner();
    showFomo(null);
    if (modeEl) modeEl.textContent = "PAPER";
    showMessage(message || "Enter the pairing code shown on the desk.");
    if (pairBox) {
      setPairStatus(message || "Enter the pairing code shown on the desk.");
      return;
    }
    var box = document.createElement("div");
    box.id = "pair-box";
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
    var btn = document.createElement("button");
    btn.id = "pair-submit";
    btn.type = "button";
    btn.textContent = "Pair";
    var status = document.createElement("p");
    status.id = "pair-status";
    status.textContent = message || "Enter the pairing code shown on the desk.";
    btn.addEventListener("click", submitPair);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") submitPair();
    });
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btn);
    box.appendChild(status);
    var main = document.querySelector("main") || document.body;
    main.appendChild(box);
    pairBox = box;
    try { input.focus(); } catch (e) {}
  }

  function submitPair() {
    if (!pairBox) return;
    var input = pairBox.querySelector("#pair-code");
    var code = input ? String(input.value || "") : "";
    var btn = pairBox.querySelector("#pair-submit");
    if (btn) btn.disabled = true;
    setPairStatus("Pairing…");
    fetch(API_BASE + "/api/pair/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, label: "iPhone" }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then(function (res) {
      if (res.status === 429) { setPairStatus("Too many attempts. Try again later."); return null; }
      if (!res.ok) { setPairStatus("That code did not work. Check it and try again."); return null; }
      return res.json();
    }).then(function (data) {
      if (!data) return;
      var t = data && data.token;
      if (!t || !TOKEN_RE.test(t)) { setPairStatus("That code did not work. Check it and try again."); return; }
      store(function (s) { s.setItem(KEY, t); });
      if (input) input.value = "";
      hidePairing();
      backoffMs = POLL_MS;
      refresh();
    }).catch(function () {
      setPairStatus("Offline.");
    }).then(function () {
      if (btn) btn.disabled = false;
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

  async function refresh() {
    var t = token();
    if (!t) { showPairing("Enter the pairing code shown on the desk."); return; }
    if (inFlight) return;
    hidePairing();
    inFlight = true;
    abortCtl = new AbortController();
    abortTimer = setTimeout(function () {
      abortTimer = null;
      if (abortCtl) {
        try { abortCtl.abort(); } catch (e) {}
      }
    }, FETCH_TIMEOUT_MS);
    try {
      var res = await fetch(API_BASE + "/api/state", {
        headers: { Authorization: "Bearer " + t },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abortCtl.signal,
      });
      if (res.status === 401) {
        clearToken();
        showPairing("Link expired or invalid. Pair this device again.");
        return;
      }
      if (!res.ok) {
        showMessage("Desk unavailable (" + res.status + ").");
        backoffMs = Math.min(Math.max(backoffMs * 2, POLL_MS * 2), BACKOFF_CAP_MS);
        schedule(backoffMs);
        return;
      }
      var data = await res.json();
      /* The badge shows PAPER unless the server explicitly says LIVE. */
      if (modeEl) modeEl.textContent = data && data.mode === "LIVE" ? "LIVE" : "PAPER";
      showHeartbeats(data && data.heartbeats);
      showFomo(data && data.fomo);
      updateStaleBanner(data);
      backoffMs = POLL_MS;
      schedule(POLL_MS);
    } catch (err) {
      if (!canPoll()) return;
      var aborted = !!(err && err.name === "AbortError");
      showMessage("Offline.");
      backoffMs = Math.min(Math.max(backoffMs * 2, POLL_MS * 2), BACKOFF_CAP_MS);
      schedule(backoffMs);
      if (aborted) return;
    } finally {
      if (abortTimer !== null) {
        clearTimeout(abortTimer);
        abortTimer = null;
      }
      abortCtl = null;
      inFlight = false;
    }
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

  var frag = readFragment();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  if (frag === "logout" || !token()) {
    showPairing(frag === "logout" ? "Enter the pairing code shown on the desk." : "Enter the pairing code shown on the desk.");
  } else {
    refresh();
  }
})();
