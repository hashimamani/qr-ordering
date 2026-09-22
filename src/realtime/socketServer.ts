import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyStaffToken } from '../lib/jwt';
import { logger } from '../lib/logger';

type Destination = 'kitchen' | 'bar' | 'waiter';

const ORDER_ROOM = /^order:[A-Za-z0-9-]+$/;
const RESTAURANT_ROOM = /^restaurant:([0-9a-fA-F-]{36}):(kitchen|bar|waiter)$/;

const rooms = new Map<string, Set<WebSocket>>();

function join(room: string, socket: WebSocket): void {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room)!.add(socket);
}

function leaveAll(socket: WebSocket): void {
  for (const members of rooms.values()) {
    members.delete(socket);
  }
}

function isAuthorizedForRestaurantRoom(token: string | undefined, restaurantId: string, destination: Destination): boolean {
  if (!token) return false;
  try {
    const payload = verifyStaffToken(token);
    if (payload.restaurantId !== restaurantId) return false;
    if (payload.role === 'admin') return true;
    return payload.role === destination;
  } catch {
    return false;
  }
}

/**
 * Minimal room-based pub/sub over a single `ws` endpoint. This is the
 * locally-runnable stand-in for the API Gateway WebSocket API described in
 * the AWS architecture notes (see infra/ and README) — same room/event
 * contract, different transport, so the client code doesn't change between
 * local dev and the deployed version.
 */
export function initRealtime(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/realtime' });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let msg: { type?: string; room?: string; token?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid json' }));
        return;
      }

      if (msg.type !== 'join' || typeof msg.room !== 'string') {
        socket.send(JSON.stringify({ type: 'error', message: 'expected {type: "join", room: "..."}' }));
        return;
      }

      if (ORDER_ROOM.test(msg.room)) {
        join(msg.room, socket);
        socket.send(JSON.stringify({ type: 'joined', room: msg.room }));
        return;
      }

      const restaurantMatch = msg.room.match(RESTAURANT_ROOM);
      if (restaurantMatch) {
        const [, restaurantId, destination] = restaurantMatch;
        if (!isAuthorizedForRestaurantRoom(msg.token, restaurantId, destination as Destination)) {
          socket.send(JSON.stringify({ type: 'error', message: 'not authorized for this room' }));
          return;
        }
        join(msg.room, socket);
        socket.send(JSON.stringify({ type: 'joined', room: msg.room }));
        return;
      }

      socket.send(JSON.stringify({ type: 'error', message: 'unrecognized room' }));
    });

    socket.on('close', () => leaveAll(socket));
    socket.on('error', (err) => logger.warn({ err }, 'websocket connection error'));
  });

  return wss;
}

export function broadcast(room: string, event: Record<string, unknown>): void {
  const members = rooms.get(room);
  if (!members || members.size === 0) return;
  const payload = JSON.stringify(event);
  for (const socket of members) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}
