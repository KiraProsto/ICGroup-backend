import { z } from 'zod';

// ─── Security helpers ─────────────────────────────────────────────────────────

/**
 * Restricts URL fields to http/https only.
 * Rejects javascript: and other inject-prone schemes (defense-in-depth, XSS).
 */
const httpUrl = () =>
  z
    .string()
    .url({ message: 'Must be a valid URL' })
    .refine((u) => /^https?:\/\//i.test(u), {
      message: 'Only http and https URLs are allowed',
    });

// ─── Card data schemas (Zod) ──────────────────────────────────────────────────

/**
 * TEXT card — Tiptap ProseMirror JSON document.
 * Only structural type-check here; deep ProseMirror validation is deferred to
 * the Tiptap editor on parse.  We enforce the mandatory `type: "doc"` root so
 * obviously malformed payloads are rejected early.
 */
export const TextCardDataSchema = z.object({
  body: z
    .object({
      type: z.literal('doc'),
      content: z.array(z.record(z.unknown())).optional(),
    })
    .passthrough(),
});

/**
 * QUOTE card — a plain-text pull-quote or blockquote.
 */
export const QuoteCardDataSchema = z.object({
  text: z.string().min(1).max(5_000),
});

/**
 * PUBLICATION card — an embedded reference to another news article.
 * The articleId is a UUID referencing NewsArticle.id.
 */
export const PublicationCardDataSchema = z.object({
  articleId: z.string().uuid({ message: 'articleId must be a valid UUID' }),
});

/**
 * IMAGE card — a single image with an optional caption.
 * URL must point to an http/https resource (not a data: or javascript: URI).
 */
export const ImageCardDataSchema = z.object({
  url: httpUrl(),
  caption: z.string().max(500).optional(),
});

/**
 * VIDEO card — a video embed URL with an optional caption.
 * Accepts any http/https URL (YouTube, Vimeo, direct MP4, etc.).
 */
export const VideoCardDataSchema = z.object({
  url: httpUrl(),
  caption: z.string().max(500).optional(),
});

// ─── Schema registry ──────────────────────────────────────────────────────────

export const CARD_DATA_SCHEMAS = {
  TEXT: TextCardDataSchema,
  QUOTE: QuoteCardDataSchema,
  PUBLICATION: PublicationCardDataSchema,
  IMAGE: ImageCardDataSchema,
  VIDEO: VideoCardDataSchema,
} as const;

export type CardType = keyof typeof CARD_DATA_SCHEMAS;

export type TextCardData = z.infer<typeof TextCardDataSchema>;
export type QuoteCardData = z.infer<typeof QuoteCardDataSchema>;
export type PublicationCardData = z.infer<typeof PublicationCardDataSchema>;
export type ImageCardData = z.infer<typeof ImageCardDataSchema>;
export type VideoCardData = z.infer<typeof VideoCardDataSchema>;

export type CardData =
  | TextCardData
  | QuoteCardData
  | PublicationCardData
  | ImageCardData
  | VideoCardData;

/**
 * Validates the card data payload against the schema for the given card type.
 * Throws a ZodError if validation fails.
 */
export function validateCardData(type: CardType, data: unknown): CardData {
  return CARD_DATA_SCHEMAS[type].parse(data) as CardData;
}
