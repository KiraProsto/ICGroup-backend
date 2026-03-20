import { FileValidator } from '@nestjs/common';

export interface MimeTypeValidatorOptions {
  allowedTypes: readonly string[];
}

/**
 * Two-layer MIME type validator:
 *   1. Allowlist check — the declared Content-Type must be in the allowed set.
 *   2. Magic-bytes check — the actual file bytes must match the declared type.
 *
 * Layer 2 prevents attackers from uploading a malicious payload (e.g. a PHP
 * script or HTML file) with a spoofed `Content-Type: image/jpeg` header.
 *
 * Supported MIME types and their magic-byte signatures:
 *   image/jpeg       — FF D8 FF
 *   image/png        — 89 50 4E 47 0D 0A 1A 0A (PNG header)
 *   image/webp       — RIFF????WEBP
 *   image/gif        — GIF87a | GIF89a
 *   image/avif       — ISOBMFF 'ftyp' box with 'avif' or 'avis' brand
 *   application/pdf  — %PDF-
 */
export class MimeTypeValidator extends FileValidator<MimeTypeValidatorOptions> {
  isValid(file?: Express.Multer.File): boolean {
    if (!file?.buffer || !file.mimetype) return false;

    const mimeType = file.mimetype.toLowerCase().split(';')[0].trim();

    if (!this.validationOptions.allowedTypes.includes(mimeType)) {
      return false;
    }

    return this.matchesMagicBytes(mimeType, file.buffer);
  }

  buildErrorMessage(): string {
    return `File type not allowed. Accepted types: ${this.validationOptions.allowedTypes.join(', ')}. Max size: 5 MiB.`;
  }

  // ── Magic-bytes detection ─────────────────────────────────────────────────

  private matchesMagicBytes(mimeType: string, buf: Buffer): boolean {
    if (buf.length < 12) return false;

    switch (mimeType) {
      case 'image/jpeg':
        return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

      case 'image/png':
        return (
          buf[0] === 0x89 &&
          buf[1] === 0x50 &&
          buf[2] === 0x4e &&
          buf[3] === 0x47 &&
          buf[4] === 0x0d &&
          buf[5] === 0x0a &&
          buf[6] === 0x1a &&
          buf[7] === 0x0a
        );

      case 'image/webp':
        // RIFF....WEBP
        return (
          buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buf.subarray(8, 12).toString('ascii') === 'WEBP'
        );

      case 'image/gif':
        // GIF87a or GIF89a
        return (
          buf[0] === 0x47 &&
          buf[1] === 0x49 &&
          buf[2] === 0x46 &&
          buf[3] === 0x38 &&
          (buf[4] === 0x37 || buf[4] === 0x39) &&
          buf[5] === 0x61
        );

      case 'image/avif':
        return this.isAvifFtyp(buf);

      case 'application/pdf':
        return buf.subarray(0, 5).toString('ascii') === '%PDF-';

      default:
        // Fail-safe: any type that reaches here is not in the allowlist.
        return false;
    }
  }

  /**
   * Validates AVIF by parsing the ISOBMFF ftyp box.
   *
   * Structure:
   *   [0..3]  box size (big-endian u32)
   *   [4..7]  'ftyp'
   *   [8..11] major brand
   *   [12..15] minor version
   *   [16..]  compatible brands (4 bytes each)
   *
   * Many AVIF encoders use 'mif1' or 'msf1' as the major brand and list
   * 'avif'/'avis' in the compatible brands, so we check both.
   */
  private isAvifFtyp(buf: Buffer): boolean {
    if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return false;

    const boxSize = buf.readUInt32BE(0);
    // Sanity: box must fit within buffer and be at least 16 bytes (header + major + minor)
    const end = Math.min(boxSize, buf.length);
    if (end < 16) return false;

    // Scan major brand (offset 8) and all compatible brands (offset 16, 20, 24, …)
    for (let offset = 8; offset + 4 <= end; offset += 4) {
      // Skip minor_version field at offset 12
      if (offset === 12) continue;
      const brand = buf.subarray(offset, offset + 4).toString('ascii');
      if (brand === 'avif' || brand === 'avis') return true;
    }

    return false;
  }
}
