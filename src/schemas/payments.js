// src/schemas/payments.js
import { z } from 'zod';

export const getOrCreateCustomerBody = z.object({
  userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
});

export const createSetupIntentBody = z.object({
  customerId: z.string().min(1, 'customerId is required'),
});

export const customerIdParams = z.object({
  customerId: z.string().min(1, 'customerId is required'),
});

export const setDefaultPaymentMethodBody = z.object({
  userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
  paymentMethodId: z.string().min(1, 'paymentMethodId is required'),
});
