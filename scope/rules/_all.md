Version-agnostic rules for every installed package (add package rules as scope/rules/<vendor>__<package>.md):
1. Copy the pattern of an existing file shown in the SNAPSHOT or in "reads" before inventing a new one.
2. A class, method, attribute, config key or syntax that you cannot see in SKILLS, DEPS, reads or VERIFIED FACTS is UNVERIFIED: probe it or avoid it.
3. Install nothing: composer.lock is fixed. Use only the installed packages and framework features (Form Requests, Policies, casts, enums, rate limiting, queued jobs) instead of hand-rolled equivalents.
4. When SKILLS and your memory disagree, follow SKILLS. When a tool error contradicts your memory, the error is right.
5. Never silence a failing check (no ignore comments, no weakened assertions); fix the cause.
