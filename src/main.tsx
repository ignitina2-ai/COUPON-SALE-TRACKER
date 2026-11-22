import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register Service Worker for PWA and Push Notifications
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
        return registration.update();
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

// Capture 1-tap install prompt immediately for Sidebar install option
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('app-can-install'));
});

// Guard against "NotFoundError: Failed to execute 'removeChild' on 'Node'"
// triggered when browser translation, fonts, or extensions manipulate React DOM nodes
if (typeof window !== 'undefined') {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      if (console && console.warn) {
        console.warn('DOM removeChild guarded: node parent mismatch', child);
      }
      return child.parentNode ? (child.parentNode.removeChild(child) as T) : child;
    }
    return originalRemoveChild.call(this, child);
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (console && console.warn) {
        console.warn('DOM insertBefore guarded: referenceNode parent mismatch', referenceNode);
      }
      if (referenceNode.parentNode) {
        return referenceNode.parentNode.insertBefore(newNode, referenceNode);
      }
    }
    return originalInsertBefore.call(this, newNode, referenceNode);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
