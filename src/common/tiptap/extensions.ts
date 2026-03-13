import { Editor, type AnyExtension, type JSONContent } from '@tiptap/core';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { generateHTML } from '@tiptap/html/server';
import StarterKit from '@tiptap/starter-kit';

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

function withEditor<T>(content: JSONContent | null | undefined, reader: (editor: Editor) => T): T {
  const editor = new Editor({
    element: null,
    editable: false,
    extensions: [...TIPTAP_EXTENSIONS],
    content: normalizeDocument(content),
  });

  try {
    return reader(editor);
  } finally {
    editor.destroy();
  }
}

export function renderToHtml(content: JSONContent | null | undefined): string {
  return generateHTML(normalizeDocument(content), [...TIPTAP_EXTENSIONS]);
}

export function extractPlainText(
  content: JSONContent | null | undefined,
  options: PlainTextExtractionOptions = {},
): string {
  return withEditor(content, (editor) =>
    editor.getText({ blockSeparator: options.blockSeparator ?? '\n\n' }).trim(),
  );
}

export function buildPublishedRichTextProjection(
  content: JSONContent | null | undefined,
): PublishedRichTextProjection {
  return {
    bodyHtml: renderToHtml(content),
    bodyText: extractPlainText(content),
  };
}
