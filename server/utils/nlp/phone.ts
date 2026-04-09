// =============================================================================
// Phone Normalization
// =============================================================================

/** Strip all non-digits. Returns the last 10 digits to normalize country-code variants. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
