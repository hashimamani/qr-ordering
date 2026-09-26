import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../lib/logger';
import {
  ORDER_ROOM,
  RESTAURANT_ROOM,
  WAITER_ROOM,
  isAuthorizedForRestaurantRoom,
  isAuthorizedForWaiterRoom,
  type Destination,
} from './roomAuth';

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

      const waiterMatch = msg.room.match(WAITER_ROOM);
      if (waiterMatch) {
        const [, restaurantId, staffId] = waiterMatch;
        if (!isAuthorizedForWaiterRoom(msg.token, restaurantId, staffId)) {
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

/**
 * Forcibly ends every connection in `room` and drops the room -- used
 * once a room will never receive another event (e.g. an order that's
 * paid and fully served), so a tab left open doesn't hold the connection
 * indefinitely. The client's own onclose handler still fires; it's told
 * beforehand (via a normal broadcast) not to reconnect.
 */
export function closeRoom(room: string): void {
  const members = rooms.get(room);
  if (!members) return;
  for (const socket of members) {
    socket.close(1000, 'room closed');
  }
  rooms.delete(room);
}
