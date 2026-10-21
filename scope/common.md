Project: yuyyuy-admin-web (branch feat/boost-skills). Company Profile + CMS + Admin Dashboard, production quality, no mock-only features.
Stack: inspect REPO SNAPSHOT first; keep the existing Laravel + Livewire starter kit, Fortify, and Flux. Database: MariaDB.
Principles: UUID primary keys, created_at/updated_at/deleted_at, foreign keys, indexes, transactions, consistent errors, permission-based authorization on the server, audit log for admin mutations, whitelisted query params (search, filters, sort, offset, limit, date range), no plaintext passwords or OTP.
Roles: super_admin, admin-writer, admin-product, writer, guest (a user can hold many roles; roles <-> permissions many-to-many). Permission naming: resource.action (articles.approve, users.manage, logs.view ...).
Article status: draft, submitted, published, suspended, removed. User status: active, non_active, suspend, banned. Products are books.
Public routes: / /articles /articles/{slug} /products /products/{slug} /about /contact.
Feature ids: NN or NNA (00-09 backend, 10-19 frontend, 20-29 QA). Every feature ships on its own branch feat/<id>; a feature never edits files owned by another feature.
