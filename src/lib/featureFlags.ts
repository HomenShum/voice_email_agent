const DEFAULT_FUNCTIONS_BASE = 'http://localhost:7071';

export const FUNCTIONS_BASE =
  ((import.meta as any).env?.VITE_FUNCTIONS_BASE_URL as string | undefined) || DEFAULT_FUNCTIONS_BASE;

const LOCAL_FUNCTIONS_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

export const supportsEmailAnalytics = LOCAL_FUNCTIONS_REGEX.test(FUNCTIONS_BASE);
export const supportsEmailCounting = supportsEmailAnalytics;

