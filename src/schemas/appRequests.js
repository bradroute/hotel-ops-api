// src/schemas/appRequests.js
import { z } from 'zod';

export const pushRegisterBody = z.object({
  expoPushToken: z.string().optional(),
  expoToken: z.string().optional(),
  expo_token: z.string().optional(),
  platform: z.string().optional().nullable(),
  deviceDesc: z.string().optional().nullable(),
  device_desc: z.string().optional().nullable(),
  user_id: z.string().uuid().optional(),
  hotel_id: z.string().uuid().optional(),
}).refine(
  (d) => d.expoPushToken || d.expoToken || d.expo_token,
  { message: 'expoPushToken, expoToken, or expo_token is required' }
);

export const appRequestBody = z
  .object({
    propertyCode: z.string().min(1, 'propertyCode is required'),
    message: z.string().min(1, 'message is required').max(500),
    lat: z.number().finite(),
    lng: z.number().finite(),
    roomNumber: z.string().optional(),
    spaceId: z.string().uuid().optional(),
    spaceSlug: z.string().optional(),
    spaceName: z.string().optional(),
    from_phone: z.string().optional(),
    priority: z.string().optional(),
    department: z.string().optional(),
  });

export const patchAppRequestBody = z.object({
  message: z.string().min(1).max(500).optional(),
  priority: z.string().optional(),
  cancel: z.boolean().optional(),
});

export const appRequestIdParams = z.object({
  id: z.string().regex(/^\d+$/, 'id must be numeric'),
});

export const spacesQuery = z.object({
  propertyCode: z.string().optional(),
  code: z.string().optional(),
  hotel_id: z.string().uuid().optional(),
  q: z.string().optional(),
});
