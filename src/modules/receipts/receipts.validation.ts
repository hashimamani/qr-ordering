import { z } from 'zod';

export const verifyReceiptChallengeSchema = z.object({
  // Capped generously: an email address can be long, and the real limit on
  // guessing is the per-receipt attempt counter, not input length.
  answer: z.string().min(1).max(254),
});
