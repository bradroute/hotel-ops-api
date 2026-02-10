// src/schemas/rooms.js
import { z } from 'zod';

export const checkinBody = z.object({
  phone: z.string().min(1, 'phone is required'),
  checkout: z.string().datetime({ message: 'checkout must be a valid ISO datetime' }),
  hotel_id: z.string().uuid({ message: 'hotel_id must be a valid UUID' }),
});

export const checkoutBody = z.object({
  hotel_id: z.string().uuid({ message: 'hotel_id must be a valid UUID' }),
});

export const roomNumberParams = z.object({
  room_number: z.string().min(1, 'room_number is required'),
});
