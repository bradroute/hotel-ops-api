// src/schemas/requests.js
import { z } from 'zod';

/* ── Shared primitives ─────────────────────────────────────── */

const hotelId = z.string().uuid({ message: 'hotel_id must be a valid UUID' });
const priority = z.enum(['low', 'normal', 'urgent']).optional();
const message = z.string().min(1, 'message is required').max(500);

/* ── POST /requests/preview ────────────────────────────────── */

export const previewBody = z
  .object({
    hotel_id: hotelId.optional(),
    propertyId: z.string().uuid().optional(),
    message,
  })
  .refine((d) => d.hotel_id || d.propertyId, {
    message: 'hotel_id or propertyId is required',
  });

/* ── POST /requests (create) ──────────────────────────────── */

export const createRequestBody = z
  .object({
    hotel_id: hotelId.optional(),
    propertyId: z.string().uuid().optional(),
    message,
    phone_number: z.string().optional(),
    from_phone: z.string().optional(),
    room_number: z.string().optional(),
    space_id: z.string().uuid().optional(),
    department: z.string().max(100).optional(),
    priority,
    source: z.string().max(50).optional(),
  })
  .refine((d) => d.hotel_id || d.propertyId, {
    message: 'hotel_id or propertyId is required',
  })
  .refine((d) => d.from_phone || d.phone_number, {
    message: 'from_phone or phone_number is required',
  });

/* ── GET /requests ────────────────────────────────────────── */

export const listRequestsQuery = z.object({
  hotel_id: hotelId,
  phone: z.string().optional(),
  show_active_only: z.enum(['0', '1']).optional(),
});

/* ── POST /requests/:id/acknowledge & complete ─────────────── */

export const requestIdParams = z.object({
  id: z.string().regex(/^\d+$/, 'id must be a numeric string'),
});

export const hotelIdQuery = z.object({
  hotel_id: hotelId,
});

/* ── POST /requests/:id/notes ─────────────────────────────── */

export const createNoteBody = z.object({
  content: z.string().min(1, 'Note content is required').max(2000),
});

export const noteIdParams = z.object({
  id: z.string().regex(/^\d+$/, 'id must be numeric'),
  noteId: z.string().regex(/^\d+$/, 'noteId must be numeric'),
});

/* ── PATCH /requests/:id ──────────────────────────────────── */

export const patchRequestBody = z
  .object({
    summary: z.string().max(1000).optional(),
    root_cause: z.string().max(1000).optional(),
    escalation_reason: z.string().max(1000).optional(),
    estimated_revenue: z.number().optional(),
    needs_attention: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });
