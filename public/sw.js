const STATIC_CACHE = "nexus-rescue-static-v3";
const OFFLINE_PAGE = "/offline.html";
const APP_SHELLS = ["/", "/victim/dashboard"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_PAGE, ...APP_SHELLS])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || "Nexus Rescue";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "มีรายการใหม่ที่ต้องตรวจสอบ",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "nexus-rescue",
    data: { url: payload.url || "/officer/dashboard" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/officer/dashboard", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return clients.openWindow(target);
  }));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/victim/dashboard")) || caches.match(OFFLINE_PAGE)),
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/_next/static/") || ["style", "script", "font", "image"].includes(request.destination);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
