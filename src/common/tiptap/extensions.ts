import { generateText, type AnyExtension, type JSONContent } from '@tiptap/core';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { generateHTML } from '@tiptap/html/server';
import StarterKit from '@tiptap/starter-kit';
import sanitizeHtml from 'sanitize-html';

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [],
};

export const TIPTAP_EXTENSIONS: readonly AnyExtension[] = Object.freeze([
  StarterKit.configure({
    link: {
      autolink: true,
      defaultProtocol: 'https',
      openOnClick: false,
      protocols: ['http', 'https', 'mailto', 'tel'],
    },
  }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  TableKit.configure({ table: { resizable: false } }),
]);

/**
 * Strict allowlist for HTML produced by Tiptap's generateHTML.
 * Covers all elements the extension set above can emit.
 * Blocks every attribute not in the list — including on*, srcdoc, data:.
 */
const TIPTAP_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // StarterKit (Prose)
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'strong',
    'em',
    's',
    'a',
    // TextStyle / Color / Highlight
    'span',
    'mark',
    // Image
    'img',
    // TableKit
    'table',
    'colgroup',
    'col',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    col: ['span'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowedStyles: {
    '*': {
      // Allow inline color / background-color (Color + Highlight extensions).
      // Restricted to hex, numeric rgb/rgba/hsl/hsla, and named colors only.
      // [^)]* is intentionally avoided to prevent CSS expression/variable injection.
      color: [
        /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[0-9.]+)?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*[0-9.]+)?\s*\)|[a-zA-Z]+)$/,
      ],
      'background-color': [
        /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[0-9.]+)?\s*\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*[0-9.]+)?\s*\)|[a-zA-Z]+)$/,
      ],
      'text-align': [/^(left|center|right|justify)$/],
    },
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

export interface PlainTextExtractionOptions {
  blockSeparator?: string;
}

export interface PublishedRichTextProjection {
  bodyHtml: string;
  bodyText: string;
}

function normalizeDocument(content: JSONContent | null | undefined): JSONContent {
  if (content == null) {
    return EMPTY_DOCUMENT;
  }

  if (typeof content !== 'object' || Array.isArray(content) || content.type !== 'doc') {
    throw new TypeError('Tiptap content must be a ProseMirror document rooted at "doc"');
  }

  return content;
}

export function renderToHtml(content: JSONContent | null | undefined): string {
  const raw = generateHTML(normalizeDocument(content), [...TIPTAP_EXTENSIONS]);
  return sanitizeHtml(raw, TIPTAP_SANITIZE_OPTIONS);
}

export function extractPlainText(
  content: JSONContent | null | undefined,
  options: PlainTextExtractionOptions = {},
): string {
  return generateText(normalizeDocument(content), [...TIPTAP_EXTENSIONS], {
    blockSeparator: options.blockSeparator ?? '\n\n',
  }).trim();
}

export function buildPublishedRichTextProjection(
  content: JSONContent | null | undefined,
): PublishedRichTextProjection {
  return {
    bodyHtml: renderToHtml(content),
    bodyText: extractPlainText(content),
  };
}
