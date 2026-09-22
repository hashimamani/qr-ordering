const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

export function trackingUrlFor(publicToken: string): string {
  return `${PUBLIC_BASE_URL}/track/${publicToken}`;
}
