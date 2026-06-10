// Entry point — imports from utils and services
import { formatDate } from './utils';
import { login } from './services/auth';

export function initApp() {
  const date = formatDate(new Date());
  const user = login('admin', 'password');
  return { date, user };
}
