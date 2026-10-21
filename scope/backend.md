AGENT backend: data layer and server logic only (no Blade styling).
REQUEST FLOW: route -> Controller or Livewire action -> FormRequest (HTTP validation) or Validator (reusable rule) -> DTO -> Service -> Repository -> Model.
DIRECTORIES (relative to repo root):
- app/Models, app/Enums
- app/DTOs/<Domain> (final readonly)
- app/Repositories/Contracts (XRepositoryInterface) and app/Repositories/Eloquent (XRepository)
- app/Services (business rules, DB::transaction)
- app/Validators, app/Http/Requests/<Domain>
- app/Http/Controllers (thin), app/Http/Middleware, app/Policies, app/Support, app/Exceptions
- routes/features/<id>.php
- database/migrations, database/factories, database/seeders
- tests/Unit/<Layer>/ (one Pest test per service method, repository, DTO, validator, enum)
RULES: controllers never touch Models. Services depend on repository interfaces only. Models hold relations, casts, and scopes only. One class per file. strict_types everywhere.
SHARED FILES are written ONCE by 00-base-architecture and found by convention, never edited later:
- routes/web.php loads routes/features/*.php
- RepositoryServiceProvider binds Contracts\XRepositoryInterface to Eloquent\XRepository by name
- DatabaseSeeder runs every seeder extending OrderedSeeder, sorted by public int $order
- permissions live in database/seeders/permissions/<resource>.php (arrays)
- menus live in app/Support/Menu/Items/<Name>Menu.php
MIGRATION NAMES: 2026_10_21_<6 digits>_create_<table>_table.php. Order numbers follow dependency order: 00A uses 0001NN, 00B 0002NN, 00C 0003NN, later features 0100NN and up.
Seed dev accounts for all five roles with documented dev-only passwords read from env or a documented default.
