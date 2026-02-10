// src/schemas/guest.js
import { z } from 'zod';

export const guestStartBody = z.object({
  name: z.string().max(200).optional(),
  phone: z.string().min(1, 'phone is required'),
  propertyCode: z.string().min(1, 'propertyCode is required').max(50),
  lat: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite()),
  lng: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite()),
});

export const hotelIdParams = z.object({
  hotelId: z.string().uuid({ message: 'hotelId must be a valid UUID' }),
});
