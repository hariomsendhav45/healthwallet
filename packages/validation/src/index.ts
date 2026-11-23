export { IsEnum, IsISO8601, IsOptional, IsString, Length } from 'class-validator';

export const INDIA_COUNTRY_CODE = '+91';
export const INDIA_MOBILE_PATTERN = /^[6-9]\d{9}$/;

export function normalizeIndiaMobile(countryCode: string, mobileNumber: string): string | null {
  const digits = mobileNumber.replace(/[\s()-]/g, '');
  if (countryCode !== INDIA_COUNTRY_CODE || !INDIA_MOBILE_PATTERN.test(digits)) return null;
  return `${INDIA_COUNTRY_CODE}${digits}`;
}

export function isIndiaPostalCode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value);
}
