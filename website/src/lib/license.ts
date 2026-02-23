import crypto from 'crypto';

/**
 * Generate a license key in the format GUIDE-XXXX-XXXX-XXXX-XXXX
 */
export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I)
  const segments: string[] = [];
  for (let s = 0; s < 4; s++) {
    let segment = '';
    for (let c = 0; c < 4; c++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      segment += chars[randomIndex];
    }
    segments.push(segment);
  }
  return `GUIDE-${segments.join('-')}`;
}

/**
 * Validate a license key format
 */
export function isValidLicenseKeyFormat(key: string): boolean {
  return /^GUIDE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key?.toUpperCase());
}
