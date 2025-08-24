self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title = data.title || 'Inköpslistan';
  const options = {
    body: data.body || 'Ny vara tillagd.',
    icon: '/icon.png',
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});