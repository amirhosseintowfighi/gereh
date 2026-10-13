/* Gereh service worker: Web Push only. Pushes carry no payload; the text is fetched with the session cookie. */
self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/push/latest", { credentials: "same-origin" })
      .then((r) => r.json())
      .catch(() => ({ title: "گره", body: "اعلان جدید دارید.", url: "/panel" }))
      .then((n) => self.registration.showNotification(n.title || "گره", { body: n.body, icon: "/icon-192.png", dir: "rtl", lang: "fa", data: { url: n.url || "/panel" } })),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/panel"));
});
