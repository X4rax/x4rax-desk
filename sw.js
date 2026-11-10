/* Service worker placeholder. Web Push lands in a later step.
   CACHE is bumped when app.js / manifest / static assets change so
   iOS home-screen apps fetch the new files. */
var CACHE = "desk-v6";
var ASSETS = ["./index.html", "./app.js", "./app.css", "./chart.js", "./manifest.json"];

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
