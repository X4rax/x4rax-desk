/* Desk front-end (PAPER). No secrets live in this file.
   Security notes:
   - The APP_TOKEN arrives only in the URL fragment (#t=...), which browsers never
     send to servers or in Referer headers. It is read once, format-checked, then
     the fragment is wiped from the address bar and history.
   - It is kept in localStorage so the iPhone home-screen app survives relaunch.
     A strict Content-Security-Policy in index.html blocks third-party and inline
     scripts, which is what could otherwise read it.
   - It is cleared on any 401, and by opening the app with #logout.
   - API data is never inserted as HTML; only textContent is used.
   - API_BASE will be set to the Cloudflare Worker origin (https://<worker>.workers.dev)
     after deploy. Leave it as "" until then so the app stays same-origin.
   - When API_BASE is set, index.html's Content-Security-Policy connect-src must
     also allow that Worker origin, e.g. connect-src 'self' https://<worker>.workers.dev.
     Do not change the CSP until the Worker origin is known. */
(function () {
  "use strict";
  var API_BASE = "https://x4rax-desk.riadh-ferjani02.workers.dev"; /* Cloudflare Worker origin */
  var KEY = "app_token";
  var TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
  var heartbeatsEl = document.getElementById("heartbeats");
  var modeEl = document.getElementById("mode");

  function store(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }
  function clearToken() { store(function (s) { s.removeItem(KEY); }); }

  function readFragment() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return;
    /* Wipe the fragment first so the token never lingers in the URL or history. */
    history.replaceState(null, "", location.pathname + location.search);
    if (raw === "logout") { clearToken(); return; }
    var t = new URLSearchParams(raw).get("t");
    if (t && TOKEN_RE.test(t)) store(function (s) { s.setItem(KEY, t); });
  }

  function token() {
    var t = store(function (s) { return s.getItem(KEY); }) || "";
    if (t && !TOKEN_RE.test(t)) { clearToken(); return ""; }
    return t;
  }

  function showMessage(text) {
    if (!heartbeatsEl) return;
    var li = document.createElement("li");
    li.textContent = text;
    heartbeatsEl.replaceChildren(li);
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

  async function refresh() {
    var t = token();
    if (!t) { showMessage("Open the app with your private link to sign in."); return; }
    try {
      var res = await fetch(API_BASE + "/api/state", {
        headers: { Authorization: "Bearer " + t },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (res.status === 401) { clearToken(); showMessage("Link expired or invalid. Open your private link again."); return; }
      if (!res.ok) { showMessage("Desk unavailable (" + res.status + ")."); return; }
      var data = await res.json();
      /* The badge shows PAPER unless the server explicitly says LIVE. */
      if (modeEl) modeEl.textContent = data && data.mode === "LIVE" ? "LIVE" : "PAPER";
      showHeartbeats(data && data.heartbeats);
    } catch (err) {
      showMessage("Offline.");
    }
  }

  readFragment();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  refresh();
})();
