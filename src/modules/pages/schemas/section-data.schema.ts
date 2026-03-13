import { z } from 'zod';
import { SectionType } from '../../../generated/prisma/enums.js';

// ─── Per-section Zod schemas ──────────────────────────────────────────────────
// Images are stored as MinIO/S3 paths — validated as non-empty strings.
// External navigation links (ctaUrl, imageUrl, avatarUrl) require http/https URLs.

/**
 * URL field restricted to http/https schemes.
 * Zod's built-in z.string().url() accepts javascript: and other schemes via
 * WHATWG URL parsing; this refinement rejects them, preventing XSS sinks.
 */
const httpUrl = () =>
  z
    .string()
    .url({ message: 'Must be a valid URL' })
    .refine((u) => /^https?:\/\//i.test(u), {
      message: 'Only http and https URLs are allowed',
    });

export const HeroDataSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  ctaText: z.string().max(100).optional(),
  ctaUrl: httpUrl().optional(),
  backgroundImage: z.string().min(1).optional(),
});

export const FeatureGridDataSchema = z.object({
  items: z
    .array(
      z.object({
        icon: z.string().max(100).optional(),
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
});

export const TestimonialsDataSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        author: z.string().min(1).max(200),
        company: z.string().max(200).optional(),
        avatarUrl: httpUrl().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const CtaDataSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  ctaText: z.string().min(1).max(100),
  ctaUrl: httpUrl(),
});

/**
 * Rejects strings that contain HTML/JS injection patterns.
 * Defense-in-depth: content is also expected to be sanitized on the frontend
 * before rendering. If rich-text HTML is needed here, replace this refinement
 * with a server-side sanitize-html call using a strict element/attribute allowlist.
 */
const UNSAFE_HTML_RE = /<script[\s>]/i;
const UNSAFE_ATTR_RE = /\s+on[a-z]+\s*=/i;
const JAVASCRIPT_PROTO_RE = /javascript\s*:/i;

const safeHtmlString = () =>
  z
    .string()
    .min(1)
    .max(50_000)
    .refine((v) => !UNSAFE_HTML_RE.test(v), { message: '<script> elements are not allowed' })
    .refine((v) => !UNSAFE_ATTR_RE.test(v), {
      message: 'Inline event handlers (on*=) are not allowed',
    })
    .refine((v) => !JAVASCRIPT_PROTO_RE.test(v), { message: 'javascript: URIs are not allowed' });

export const TextDataSchema = z.object({
  content: safeHtmlString(),
});

export const GalleryDataSchema = z.object({
  items: z
    .array(
      z.object({
        imageUrl: httpUrl(),
        caption: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
});

// ─── Schema registry keyed by SectionType ────────────────────────────────────

export const SectionDataSchemas = {
  [SectionType.HERO]: HeroDataSchema,
  [SectionType.FEATURE_GRID]: FeatureGridDataSchema,
  [SectionType.TESTIMONIALS]: TestimonialsDataSchema,
  [SectionType.CTA]: CtaDataSchema,
  [SectionType.TEXT]: TextDataSchema,
  [SectionType.GALLERY]: GalleryDataSchema,
} as const satisfies Record<SectionType, z.ZodTypeAny>;

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type HeroData = z.infer<typeof HeroDataSchema>;
export type FeatureGridData = z.infer<typeof FeatureGridDataSchema>;
export type TestimonialsData = z.infer<typeof TestimonialsDataSchema>;
export type CtaData = z.infer<typeof CtaDataSchema>;
export type TextData = z.infer<typeof TextDataSchema>;
export type GalleryData = z.infer<typeof GalleryDataSchema>;

export type SectionData =
  | HeroData
  | FeatureGridData
  | TestimonialsData
  | CtaData
  | TextData
  | GalleryData;
