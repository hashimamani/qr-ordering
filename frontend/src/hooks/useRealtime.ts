import { useEffect, useRef, useState } from 'react';

const WS_BASE = import.meta.env.VITE_WS_BASE_URL;

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Joins `room` (with `token` for auth-gated restaurant rooms) and calls
 * onEvent for every message after the join ack. Auto-reconnects with
 * linear backoff; callers just get a `connected` flag and a callback,
 * same room/event contract whether this hits the local ws server or the
 * deployed API Gateway WebSocket API.
 */
export function useRealtime(room: string | null, token: string | null, onEvent: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!room) return;

    let socket: WebSocket;
    let attempt = 0;
    let closedByEffect = false;
    // Set once the server says this room is done for good (e.g. an
    // order that's paid and fully served) -- there's nothing left to
    // reconnect for, so stop trying and let the connection go rather
    // than holding it (and the server-side resources behind it) open
    // indefinitely for a tab the customer just leaves open.
    let done = false;

    function connect() {
      socket = new WebSocket(WS_BASE);

      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ type: 'join', room, token }));
      };
      socket.onmessage = (msg) => {
        const event = JSON.parse(msg.data);
        if (event.type === 'joined') {
          setConnected(true);
          return;
        }
        if (event.type === 'error') {
          console.warn('realtime error:', event.message);
          return;
        }
        if (event.type === 'order_complete') {
          done = true;
          onEventRef.current(event);
          socket.close();
          return;
        }
        onEventRef.current(event);
      };
      socket.onclose = () => {
        setConnected(false);
        if (closedByEffect || done) return;
        attempt += 1;
        setTimeout(connect, Math.min(1000 * attempt, 10000));
      };
      socket.onerror = () => socket.close();
    }

    connect();

    return () => {
      closedByEffect = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, token]);

  return { connected };
}
