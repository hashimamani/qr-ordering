import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { VapidPublicKeyResponse } from '../api/types';
import { useToast } from '../components/ToastProvider';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushStatus = 'idle' | 'enabling' | 'enabled' | 'denied' | 'unsupported' | 'error';

/**
 * Encapsulates the browser-side web-push flow: register the service
 * worker, request permission, subscribe with the server's VAPID public
 * key, and hand the subscription to the backend. Runs automatically on
 * mount (see the effect below) rather than waiting for a button click --
 * a waiter shouldn't have to remember to opt in to being told a customer
 * needs them. The browser's own permission prompt is unavoidable (and a
 * real security boundary we can't and shouldn't bypass); this just
 * removes our own extra click in front of it, and no-ops quietly if a
 * subscription already exists from a previous visit.
 */
export function usePushSubscription() {
  const showToast = useToast();
  const [status, setStatus] = useState<PushStatus>('idle');

  async function enable() {
    setStatus('enabling');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');

      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        setStatus('enabled');
        return;
      }

      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }
      const { publicKey } = await apiFetch<VapidPublicKeyResponse>('/staff/push/vapid-public-key', { auth: true });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      await apiFetch('/staff/push/subscribe', { method: 'POST', auth: true, body: subscription.toJSON() });
      setStatus('enabled');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }

  useEffect(() => {
    enable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, enable };
}
