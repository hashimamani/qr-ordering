import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { fixedWindowRateLimit } from '../lib/rateLimit';
import { NotFoundError, ValidationError } from '../lib/errors';
import { resolveTableForOrdering } from '../modules/tables/tables.service';
import { placeOrder } from '../modules/orders/orders.service';
import { createOrderSchema } from '../modules/orders/orders.validation';
import { findOrderByPublicToken, findRestaurantIdForOrder } from '../modules/tracking/tracking.repository';
import {
  findTableContextByPublicToken,
  assignNextWaiterRoundRobin,
  markTableCalling,
} from '../modules/tables/tables.repository';
import {
  describeReceiptChallenge,
  verifyAndLoadReceipt,
  loadReceiptForDownload,
  loadReceiptForMediaFetch,
} from '../modules/receipts/receipts.service';
import { verifyReceiptChallengeSchema } from '../modules/receipts/receipts.validation';
import { broadcastToTableWaiter } from '../realtime/waiterBroadcast';
import { sendPushToStaff } from '../realtime/webPush';
import { cancelOrderAsCustomer } from '../modules/orderItems/cancellation.service';
import { cancelOrderSchema } from '../modules/orderItems/cancellation.validation';

export const customerRoutes = Router();

customerRoutes.get(
  '/r/:slug/t/:qrToken',
  asyncHandler(async (req, res) => {
    const { slug, qrToken } = req.params;
    const result = await resolveTableForOrdering(slug, qrToken);
    res.json(result);
  }),
);

customerRoutes.post(
  '/r/:slug/t/:qrToken/orders',
  asyncHandler(async (req, res) => {
    const { slug, qrToken } = req.params;
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid order payload', parsed.error.flatten());
    }
    const result = await placeOrder(slug, qrToken, parsed.data);
    res.status(201).json(result);
  }),
);

customerRoutes.post(
  '/track/:publicToken/cancel',
  // The public token is the only credential a diner has, same as the
  // tracking page itself. Rate-limited because it is unauthenticated and
  // mutates: without it, a guessed token could be hammered.
  fixedWindowRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const restaurantId = await findRestaurantIdForOrder(req.params.publicToken);
    if (!restaurantId) throw new NotFoundError('Order not found');
    const parsed = cancelOrderSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid cancel payload', parsed.error.flatten());
    const result = await cancelOrderAsCustomer(
      restaurantId,
      req.params.publicToken,
      parsed.data.order_item_id,
    );
    res.json({ cancelled_items: result.items.length, order_fully_cancelled: result.orderFullyCancelled });
  }),
);

customerRoutes.get(
  '/track/:publicToken',
  fixedWindowRateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const order = await findOrderByPublicToken(req.params.publicToken);
    res.json(order);
  }),
);

customerRoutes.post(
  '/track/:publicToken/call-waiter',
  fixedWindowRateLimit({ windowMs: 60_000, max: 3 }),
  asyncHandler(async (req, res) => {
    const context = await findTableContextByPublicToken(req.params.publicToken);
    // A call-waiter press claims a still-unassigned table too, same as a
    // first order -- either can be the moment a table gets a waiter.
    let assignedWaiterId = context.assigned_waiter_id;
    if (!assignedWaiterId) {
      assignedWaiterId = await assignNextWaiterRoundRobin(context.restaurant_id, context.table_id);
    }
    await markTableCalling(context.table_session_id);
    await broadcastToTableWaiter(context.restaurant_id, context.table_id, {
      type: 'call_waiter',
      table_number: context.table_number,
    });
    if (assignedWaiterId) {
      await sendPushToStaff(assignedWaiterId, {
        title: `Table ${context.table_number}`,
        body: 'Needs you',
      });
    }
    res.status(204).send();
  }),
);

// --- Receipts --------------------------------------------------------
//
// Public, but two-factor by construction: possession of an unguessable
// link plus proof of the contact it was sent to. The link is only ever
// delivered to order.contact_value, honouring the rule recorded on that
// column in the initial schema -- the receipt goes back to the contact on
// the order, never to whoever asks for it.
//
// Rate limits are tighter than the tracking endpoints because the second
// factor for an SMS order is only four digits. The per-receipt attempt
// counter in receipts.service.ts is what actually caps brute force, since
// an IP limit alone can be sidestepped by rotating addresses.

customerRoutes.get(
  '/receipt/:token',
  fixedWindowRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const prompt = await describeReceiptChallenge(req.params.token);
    res.json(prompt);
  }),
);

customerRoutes.post(
  '/receipt/:token/verify',
  fixedWindowRateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const parsed = verifyReceiptChallengeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());
    const result = await verifyAndLoadReceipt(req.params.token, parsed.data.answer);
    res.json(result);
  }),
);

customerRoutes.get(
  '/receipt/:token/pdf',
  fixedWindowRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    // Two ways in, and only two: a customer's bearer grant (issued after
    // they answer the last-4 challenge), or a single-use media token the
    // send path minted for the messaging provider, which has no way to
    // answer a challenge. The media token is redeemed atomically and
    // cleared, so the URL in the provider's logs is inert afterwards.
    const mediaToken = typeof req.query.m === 'string' ? req.query.m : undefined;
    const grant = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const receipt = mediaToken
      ? await loadReceiptForMediaFetch(req.params.token, mediaToken)
      : await loadReceiptForDownload(req.params.token, grant);
    // Lazy import for the same reason the report exporters use one: keep
    // pdfkit off the cold-start path of a Lambda that also places orders.
    const { renderReceiptPdf } = await import('../modules/receipts/receipts.pdf');
    const body = await renderReceiptPdf(receipt);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="receipt_${receipt.order_public_token.slice(0, 8)}.pdf"`,
    );
    res.send(body);
  }),
);
