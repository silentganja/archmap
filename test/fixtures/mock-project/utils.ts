// Utility functions
import { padLeft } from './helpers';

export function formatDate(date: Date): string {
  const month = padLeft(String(date.getMonth() + 1), 2, '0');
  const day = padLeft(String(date.getDate()), 2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
