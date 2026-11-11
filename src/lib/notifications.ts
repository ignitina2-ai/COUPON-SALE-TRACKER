
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    console.log('This browser does not support desktop notification');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.warn('Notification permission error:', error);
      return false;
    }
  }

  return false;
};

export const sendNotification = (title: string, options?: NotificationOptions) => {
  const notificationOptions = {
    icon: '/splash/mobile.jpg',
    badge: '/notification-badge.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    ...options
  };

  // Try sending native notification via Service Worker ONLY IF permission has been explicitly granted
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => {
            if (Notification.permission === 'granted') {
              return registration.showNotification(title, notificationOptions);
            }
          })
          .catch((err) => {
            console.warn('Service Worker notification notice:', err);
            fallbackLegacyNotification(title, notificationOptions);
          });
      } else {
        fallbackLegacyNotification(title, notificationOptions);
      }
    }
  } catch (err) {
    console.warn('Native notification suppressed:', err);
  }

  // Always dispatch a custom event so the in-app toast listener can show it beautifully
  try {
    const event = new CustomEvent('app-notification', {
      detail: {
        title,
        body: options?.body || '',
        icon: '/splash/mobile.jpg'
      }
    });
    window.dispatchEvent(event);
  } catch (error) {
    console.error('Custom event dispatch failed:', error);
  }
};

const fallbackLegacyNotification = (title: string, options?: NotificationOptions) => {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, options);
    }
  } catch (error) {
    console.warn('Desktop notification legacy constructor failed:', error);
  }
};
