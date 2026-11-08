import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const key of Object.keys(obj as any)) {
      const val = (obj as any)[key];
      if (val !== undefined) {
        newObj[key] = cleanUndefined(val);
      }
    }
    return newObj as T;
  }
  return obj;
}

/**
 * Calculates the exact coupon range from a book number string.
 * Each book contains 25 coupons (COUPONS_PER_BOOK = 25).
 * Examples:
 * - "1-70" -> "1 - 1750"
 * - "71" -> "1751 – 1775"
 * - "1 to 70" -> "1 - 1750"
 * - "1-2, 5" -> "1 - 50, 101 – 125"
 */
export function calculateCouponRangeFromBookString(bookStr?: string, couponsPerBook = 25): string {
  if (!bookStr || typeof bookStr !== 'string') return '';
  const trimmed = bookStr.trim();
  if (!trimmed) return '';

  const clean = trimmed.split('=')[0].trim().replace(/^(?:books?|b)\s*[:#]?\s*/i, '');
  const parts = clean.split(/[,;&]|\band\b/i);
  const results: string[] = [];

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;

    // Range: "1-70", "1 - 70", "1 to 70", "1–70", "1—70"
    const rangeMatch = part.match(/^(\d+)\s*(?:[-–—]|to)\s*(\d+)$/i);
    if (rangeMatch) {
      const bStart = parseInt(rangeMatch[1], 10);
      const bEnd = parseInt(rangeMatch[2], 10);
      if (!isNaN(bStart) && !isNaN(bEnd) && bStart > 0 && bEnd >= bStart) {
        const cStart = (bStart - 1) * couponsPerBook + 1;
        const cEnd = bEnd * couponsPerBook;
        results.push(`${cStart} - ${cEnd}`);
        continue;
      }
    }

    // Single standalone book number: "71"
    const singleMatch = part.match(/^\b(\d+)\b$/);
    if (singleMatch) {
      const bNum = parseInt(singleMatch[1], 10);
      if (!isNaN(bNum) && bNum > 0) {
        const cStart = (bNum - 1) * couponsPerBook + 1;
        const cEnd = bNum * couponsPerBook;
        results.push(`${cStart} – ${cEnd}`);
        continue;
      }
    }
  }

  return results.join(', ');
}

/**
 * Returns the effective coupon number for a transaction:
 * Prefers explicitly stored couponNumber, otherwise computes it from bookNumber if available.
 */
export function getEffectiveCouponNumber(transaction: { couponNumber?: string; bookNumber?: string }): string {
  if (transaction.couponNumber && transaction.couponNumber.trim()) {
    return transaction.couponNumber.trim();
  }
  if (transaction.bookNumber && transaction.bookNumber.trim()) {
    return calculateCouponRangeFromBookString(transaction.bookNumber);
  }
  return '';
}

