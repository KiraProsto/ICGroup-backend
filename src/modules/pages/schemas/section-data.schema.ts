import sanitizeHtml from 'sanitize-html';
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
 * Strict HTML allowlist for TEXT sections.
 * Only formatting/structure elements that render safely in the admin panel
 * are permitted. No script, no event handlers, no javascript: URIs.
 */
const ALLOWED_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'u',
    's',
    'code',
    'pre',
    'blockquote',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'span',
    'div',
    'mark',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': ['class', 'style'],
  },
  // Restrict inline styles to a small, explicit allowlist of safe properties.
  // This prevents arbitrary CSS from being injected while still allowing
  // basic text formatting coming from the editor.
  allowedStyles: {
    '*': {
      'text-align': [/^(?:left|right|center|justify)$/],
      'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/],
      'font-style': [/^(?:normal|italic)$/],
      'text-decoration': [/^(?:none|underline|line-through|overline)$/],
      // Strict color formats: hex, rgb/rgba/hsl/hsla with numeric args only, or named colors.
      // Using [^)]* is intentionally avoided — restricting to numeric values prevents CSS injection.
      color: [
        /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[0-9.]+)?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*[0-9.]+)?\s*\)|[a-zA-Z]+)$/,
      ],
      'background-color': [
        /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[0-9.]+)?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*[0-9.]+)?\s*\)|[a-zA-Z]+)$/,
      ],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
  },
  // Force safe link behaviour
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

const safeHtmlString = () =>
  z
    .string()
    .min(1)
    .max(50_000)
    .transform((v) => sanitizeHtml(v, ALLOWED_HTML_OPTIONS))
    .refine((v) => v.trim().length > 0, {
      message: 'HTML content must not be empty after sanitization',
    });

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
