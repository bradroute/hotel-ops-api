// src/schemas/appAuth.js
import { z } from 'zod';

export const signupBody = z.object({
  fullName: z.string().min(1, 'fullName is required').max(200),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(1, 'phone is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'password is required'),
});
