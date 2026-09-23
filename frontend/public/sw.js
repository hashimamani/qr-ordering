// Minimal web-push service worker for the waiter dashboard -- registered
// from WaiterPage.tsx when a waiter clicks "Enable notifications". Vite
// serves everything under public/ as-is at the site root, so this is
// reachable at /sw.js regardless of which route registered it.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'QR Ordering', {
      body: data.body ?? '',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    if (clients.length > 0) {
      clients[0].focus();
      return;
    }
    self.clients.openWindow('/staff/waiter');
  }));
});
