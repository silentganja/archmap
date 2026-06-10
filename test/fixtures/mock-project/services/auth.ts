// Auth service — imports from utils
import { clamp } from '../utils';

export function login(username: string, password: string): { token: string } {
  const attempts = clamp(1, 0, 5);
  return { token: `tok_${username}_${attempts}` };
}

export function logout(): void {
  // clear session
}
