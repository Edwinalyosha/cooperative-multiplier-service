import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(1, 'Username cannot be blank')
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          "Username may only contain letters, numbers, '-' or '_'",
        ),
    ),
  password: z.string().min(1, 'Password is required'),
});

export type LoginFormData = z.infer<typeof loginSchema>;
