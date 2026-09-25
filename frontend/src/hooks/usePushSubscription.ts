import { useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import type { VapidPublicKeyResponse } from '../api/types';
import { useToast } from '../components/ToastProvider';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Encapsulates the browser-side web-push opt-in flow: register the service
 * worker, request permission, subscribe with the server's VAPID public key,
 * and hand the subscription to the backend. Deliberately opt-in (a button
 * the waiter clicks), not auto-run on mount -- browsers throttle/penalize
 * unsolicited permission prompts.
 */
export function usePushSubscription() {
  const showToast = useToast();
  const [status, setStatus] = useState<'idle' | 'enabling' | 'enabled' | 'error'>('idle');

  async function enable() {
    setStatus('enabling');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push notifications are not supported in this browser.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
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

  return { status, enable };
}
