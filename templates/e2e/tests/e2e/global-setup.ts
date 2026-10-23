import { execSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

// Fresh database + one user per role (E2eUsersSeeder writes storage/e2e-users.json).
export default async function globalSetup(): Promise<void> {
  closeSync(openSync('database/e2e.sqlite', 'a'));
  execSync('php artisan migrate:fresh --seed --force', { stdio: 'inherit' });
  execSync('php artisan db:seed --class=E2eUsersSeeder --force', { stdio: 'inherit' });
}
