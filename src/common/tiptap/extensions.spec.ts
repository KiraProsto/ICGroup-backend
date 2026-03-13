import type { JSONContent } from '@tiptap/core';

jest.mock('@tiptap/html/server', () => ({
  generateHTML: jest.fn(),
}));

import { generateHTML } from '@tiptap/html/server';

import {
  TIPTAP_EXTENSIONS,
  buildPublishedRichTextProjection,
  extractPlainText,
  renderToHtml,
} from './extensions.js';

const generateHtmlMock = jest.mocked(generateHTML);

describe('tiptap extensions helpers', () => {
  beforeEach(() => {
    generateHtmlMock.mockReset();
  });

  it('renders server-side HTML with the shared extension registry', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [
            {
              type: 'text',
              marks: [{ type: 'underline' }],
              text: 'Release notes',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read the ' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
              text: 'full article',
            },
          ],
        },
      ],
    };

    generateHtmlMock.mockReturnValue('<rendered-html />');

    const html = renderToHtml(content);

    expect(html).toBe('<rendered-html />');
    expect(generateHtmlMock).toHaveBeenCalledTimes(1);
    expect(generateHtmlMock).toHaveBeenCalledWith(content, expect.any(Array));

    const [, extensions] = generateHtmlMock.mock.calls[0] ?? [];

    expect(extensions).toHaveLength(TIPTAP_EXTENSIONS.length);
  });

  it('extracts plain text for FTS with stable block separators', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Quarterly report' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Revenue grew by 14 percent.' }],
        },
      ],
    };

    expect(extractPlainText(content)).toBe('Quarterly report\n\nRevenue grew by 14 percent.');
    expect(extractPlainText(content, { blockSeparator: ' | ' })).toBe(
      'Quarterly report | Revenue grew by 14 percent.',
    );
  });

  it('builds the publish-time dual-write projection', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Publish once, query twice.' }],
        },
      ],
    };

    generateHtmlMock.mockReturnValue('<p>Publish once, query twice.</p>');

    expect(buildPublishedRichTextProjection(content)).toEqual({
      bodyHtml: '<p>Publish once, query twice.</p>',
      bodyText: 'Publish once, query twice.',
    });
  });

  it('returns empty projections for empty documents', () => {
    generateHtmlMock.mockReturnValue('');

    expect(renderToHtml(undefined)).toBe('');
    expect(extractPlainText(undefined)).toBe('');
    expect(buildPublishedRichTextProjection(undefined)).toEqual({
      bodyHtml: '',
      bodyText: '',
    });
  });

  it('rejects invalid tiptap payload roots', () => {
    const invalidContent = { type: 'paragraph' } as JSONContent;

    expect(() => renderToHtml(invalidContent)).toThrow(TypeError);
    expect(() => extractPlainText(invalidContent)).toThrow(TypeError);
  });
});
