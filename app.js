/* Placeholder frontend. Talks to /api only after a token is stored locally.
   The token is never hardcoded here. */
(function () {
  const heartbeatsEl = document.getElementById("heartbeats");
  const modeEl = document.getElementById("mode");

  function token() {
    try {
      const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
      const fromHash = hash.get("t");
      if (fromHash) {
        localStorage.setItem("app_token", fromHash);
        history.replaceState(null, "", location.pathname + location.search);
      }
      return localStorage.getItem("app_token") || "";
    } catch (err) {
      return "";
    }
  }

  async function refresh() {
    const t = token();
    if (!t) {
      if (heartbeatsEl) heartbeatsEl.innerHTML = "<li>Waiting for a login token in the URL fragment.</li>";
      return;
    }
    try {
      const res = await fetch("/api/state", {
        headers: { Authorization: "Bearer " + t },
      });
      if (res.status === 401) {
        if (heartbeatsEl) heartbeatsEl.innerHTML = "<li>Unauthorized.</li>";
        return;
      }
      const data = await res.json();
      if (modeEl && data.mode) modeEl.textContent = data.mode;
      if (heartbeatsEl && data.heartbeats) {
        heartbeatsEl.innerHTML = Object.keys(data.heartbeats)
          .sort()
          .map(function (k) { return "<li>" + k + " · " + data.heartbeats[k] + "</li>"; })
          .join("");
      }
    } catch (err) {
      if (heartbeatsEl) heartbeatsEl.innerHTML = "<li>Offline.</li>";
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  refresh();
})();
