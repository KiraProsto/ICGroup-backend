import { MimeTypeValidator } from './mime-type.validator.js';
import { ALLOWED_MIME_TYPES } from '../media.controller.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(mimeType: string, buffer: Buffer, originalname = 'file'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: mimeType,
    buffer,
    size: buffer.length,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
  };
}

// Magic-bytes helpers
const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]);
const pngBuf = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(10).fill(0),
]);
const webpBuf = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46, // RIFF
  0x00,
  0x00,
  0x00,
  0x00, // file size (placeholder)
  0x57,
  0x45,
  0x42,
  0x50, // WEBP
  ...new Array(10).fill(0),
]);
const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(10).fill(0)]); // GIF89a
const pdfBuf = Buffer.from('%PDF-1.4\x00' + '\x00'.repeat(10));
const avifBuf = Buffer.from([
  0x00,
  0x00,
  0x00,
  0x1c, // box size (28 bytes)
  0x66,
  0x74,
  0x79,
  0x70, // 'ftyp'
  0x61,
  0x76,
  0x69,
  0x66, // 'avif' major brand
  ...new Array(10).fill(0),
]);
// mif1 major brand with avif in compatible brands (common in Apple/libheif encoders)
const avifMif1Buf = Buffer.from([
  0x00,
  0x00,
  0x00,
  0x18, // box size (24 bytes)
  0x66,
  0x74,
  0x79,
  0x70, // 'ftyp'
  0x6d,
  0x69,
  0x66,
  0x31, // 'mif1' major brand
  0x00,
  0x00,
  0x00,
  0x00, // minor version
  0x61,
  0x76,
  0x69,
  0x66, // 'avif' compatible brand
  0x6d,
  0x69,
  0x66,
  0x31, // 'mif1' compatible brand
]);
const maliciousBuf = Buffer.from('<script>alert(1)</script>' + '\x00'.repeat(10));

// ─────────────────────────────────────────────────────────────────────────────

describe('MimeTypeValidator', () => {
  const validator = new MimeTypeValidator({ allowedTypes: ALLOWED_MIME_TYPES });

  describe('isValid', () => {
    // Happy paths ─────────────────────────────────────────────────────────────

    it('accepts a valid JPEG', () => {
      expect(validator.isValid(makeFile('image/jpeg', jpegBuf))).toBe(true);
    });

    it('accepts a valid PNG', () => {
      expect(validator.isValid(makeFile('image/png', pngBuf))).toBe(true);
    });

    it('accepts a valid WebP', () => {
      expect(validator.isValid(makeFile('image/webp', webpBuf))).toBe(true);
    });

    it('accepts a valid GIF', () => {
      expect(validator.isValid(makeFile('image/gif', gifBuf))).toBe(true);
    });

    it('accepts a valid PDF', () => {
      expect(validator.isValid(makeFile('application/pdf', pdfBuf))).toBe(true);
    });

    it('accepts a valid AVIF', () => {
      expect(validator.isValid(makeFile('image/avif', avifBuf))).toBe(true);
    });

    it('accepts AVIF with mif1 major brand and avif in compatible brands', () => {
      expect(validator.isValid(makeFile('image/avif', avifMif1Buf))).toBe(true);
    });

    // Allowlist rejections ────────────────────────────────────────────────────

    it('rejects an unlisted MIME type (text/html)', () => {
      expect(validator.isValid(makeFile('text/html', maliciousBuf))).toBe(false);
    });

    it('rejects image/svg+xml (XSS risk)', () => {
      expect(validator.isValid(makeFile('image/svg+xml', maliciousBuf))).toBe(false);
    });

    it('rejects application/javascript', () => {
      expect(validator.isValid(makeFile('application/javascript', maliciousBuf))).toBe(false);
    });

    // Magic-bytes spoofing ────────────────────────────────────────────────────

    it('rejects a file that claims to be JPEG but has PNG magic bytes', () => {
      // Attacker sets Content-Type: image/jpeg but sends a PNG file
      expect(validator.isValid(makeFile('image/jpeg', pngBuf))).toBe(false);
    });

    it('rejects a file that claims to be PNG but contains a script', () => {
      expect(validator.isValid(makeFile('image/png', maliciousBuf))).toBe(false);
    });

    it('rejects a file that claims to be PDF but has JPEG magic bytes', () => {
      expect(validator.isValid(makeFile('application/pdf', jpegBuf))).toBe(false);
    });

    // Edge cases ──────────────────────────────────────────────────────────────

    it('rejects when file is undefined', () => {
      expect(validator.isValid(undefined)).toBe(false);
    });

    it('rejects a buffer that is too short for magic-bytes check', () => {
      const tinyBuf = Buffer.from([0xff, 0xd8]); // only 2 bytes
      expect(validator.isValid(makeFile('image/jpeg', tinyBuf))).toBe(false);
    });

    it('strips Content-Type parameters (e.g. charset) before checking the allowlist', () => {
      // Some clients send "image/jpeg; charset=utf-8"
      const fileWithParams = makeFile('image/jpeg; charset=utf-8', jpegBuf);
      expect(validator.isValid(fileWithParams)).toBe(true);
    });
  });

  describe('buildErrorMessage', () => {
    it('returns a message that lists the allowed types', () => {
      const msg = validator.buildErrorMessage();
      expect(msg).toContain('image/jpeg');
      expect(msg).toContain('5 MiB');
    });
  });
});
