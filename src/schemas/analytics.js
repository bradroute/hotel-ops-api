// src/schemas/analytics.js
import { z } from 'zod';

export const analyticsFullQuery = z.object({
  hotel_id: z.string().uuid({ message: 'hotel_id must be a valid UUID' }),
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  tzOffsetMinutes: z.string().optional(),
  commonTopN: z.string().optional(),
  commonMinLen: z.string().optional(),
  commonMinCount: z.string().optional(),
});
