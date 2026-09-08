/* NexaAtende — service worker dedicado a notificações push.
   Não faz cache de páginas nem intercepta navegação. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "NexaAtende", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "NexaAtende";
  const options = {
    body: data.body || "",
    icon: "/app-icon-512.png",
    badge: "/app-icon-512.png",
    tag: data.tag || "nexaatende",
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    vibrate: [200, 100, 200],
    silent: false,
    data: { url: data.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch (_e) {
              /* ignora */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
