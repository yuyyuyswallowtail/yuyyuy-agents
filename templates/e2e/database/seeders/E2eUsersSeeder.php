<?php

declare(strict_types=1);

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Role;

/**
 * One test user per role for the Playwright run (local and testing only, never production).
 * Writes storage/e2e-users.json: [{role, email, password}].
 */
final class E2eUsersSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->command?->warn('E2eUsersSeeder only runs in local or testing.');

            return;
        }

        $model = config('auth.providers.users.model');
        $users = [];

        foreach (Role::query()->orderBy('name')->get() as $role) {
            $email = 'e2e-'.str($role->name)->slug().'@example.test';
            $user = $model::query()->firstOrNew(['email' => $email]);
            $user->forceFill([
                'name' => 'E2E '.$role->name,
                'password' => Hash::make('password'),
                'email_verified_at' => now(),
            ])->save();
            $user->syncRoles([$role->name]);
            $users[] = ['role' => $role->name, 'email' => $email, 'password' => 'password'];
        }

        file_put_contents(storage_path('e2e-users.json'), json_encode($users, JSON_PRETTY_PRINT)."\n");
    }
}
