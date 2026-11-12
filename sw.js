/* Service worker (network first, cache fallback) plus Web Push display. The push payload is {title, body, route, tag}: the text is shown
   as sent (the desk never puts secrets in it) and a tap opens the app on that route.
   CACHE is bumped when app.js / manifest / static assets change so
   iOS home-screen apps fetch the new files. */
var CACHE = "x4rax-desk-v10";
var ASSETS = ["./index.html", "./app.js", "./ui.js", "./boot.js", "./screens-flow.js", "./screens-dash.js", "./app.css", "./chart.js", "./screens-m3.js", "./manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});

self.addEventListener("push", function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  var title = typeof d.title === "string" && d.title ? d.title.slice(0, 80) : "X4rax Desk";
  var body = typeof d.body === "string" ? d.body.slice(0, 200) : "";
  var route = /^(alerts|dashboard|pipeline|positions|scanner)$/.test(d.route) ? d.route : "alerts";
  var tag = typeof d.tag === "string" ? d.tag.slice(0, 80) : "x4rax";
  event.waitUntil(self.registration.showNotification(title, { body: body, tag: tag, data: { route: route }, icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var route = (event.notification.data && event.notification.data.route) || "alerts";
  var url = new URL("./#" + route, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("focus" in list[i]) { list[i].navigate(url).catch(function () {}); return list[i].focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
