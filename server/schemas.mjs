import { z } from 'zod';

export const identifier = z.string().uuid();
export const timingSchema = z.object({
  intervalSeconds: z.number().int().min(3).max(86400),
  hourlyLimit: z.number().int().min(1).max(10000),
  dailyLimit: z.number().int().min(1).max(100000),
  typingSeconds: z.number().int().min(0).max(5),
});
export const accountSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const listSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[a-f0-9]{6}$/i)
    .default('#16a078'),
});
export const contactSchema = z.object({
  name: z.string().trim().max(200).default(''),
  phone: z.string().max(80),
  company: z.string().trim().max(200).default(''),
  country: z.string().length(2).default('BR'),
  listIds: z.array(identifier).max(100).default([]),
  optedOut: z.boolean().default(false),
  fields: z.record(z.string().max(100), z.string().max(10000)).default({}),
});
export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  accountId: identifier,
  template: z.string().max(10000),
  allContacts: z.boolean().default(false),
  contactIds: z.array(identifier).max(20000).default([]),
  listIds: z.array(identifier).max(100).default([]),
  groups: z
    .array(z.object({ id: z.string().regex(/^\d+(?:-\d+)?@g\.us$/), name: z.string().max(200) }))
    .max(1000)
    .default([]),
  attachmentIds: z.array(identifier).max(5).default([]),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
  timing: timingSchema,
});
