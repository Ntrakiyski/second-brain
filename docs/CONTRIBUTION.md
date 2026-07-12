# Contribution Guide

This document describes the process used to build the **Shared Memory** (v2) feature. Use this as a template for future features — each gets its own folder under `docs/`.

## Folder Convention

```
docs/
├── shared-memory/       # <-- v2 multi-user feature (this one)
│   ├── GOAL.md          #    What we set out to build
│   ├── PRD.md           #    Full product spec (user stories, decisions, scope)
│   ├── tasks/           #    14 tracer-bullet tickets, one per file
│   │   ├── 01-auth-infrastructure.md
│   │   ├── ...
│   │   └── README.md    #    Ticket dependency graph + status
│   ├── CURRENT_STATE.md #    Post-mortem snapshot of what was built
│   └── skills-lock.json #    Skills installed at time of build
├── CONTRIBUTION.md      # <-- this file
└── <next-feature>/      #    Future feature folder (same structure)
```

When starting a new feature or version, create a folder under `docs/` named after it, and follow the process below.

## Process

### 1. Goal — write GOAL.md

Start with a single markdown file describing what you want to build. Keep it short — one or two sentences of the outcome, plus a few bullet points of constraints or must-haves.

**Example (shared-memory/GOAL.md):**
```
# Goal: Multi-User Shared Memory Platform
Extend Second Brain from single-user to multi-user...
```

### 2. PRD — convert GOAL.md to PRD.md

Use the **to-prod** skill (or equivalent) to convert the GOAL.md into a full Product Requirements Document. The PRD should include:

- **User stories** — who needs what and why
- **Implementation decisions** — architecture choices, auth flow, data model changes
- **Testing decisions** — what gets tested at unit vs integration level
- **Out-of-scope items** — explicit boundaries to prevent scope creep
- **Migration plan** — how existing data moves to the new schema

Run: interact with the AI agent with the GOAL.md as context and ask it to convert it into a detailed PRD. The AI will interview you to resolve ambiguities, then produce `PRD.md`.

### 3. Decompose — break PRD into tickets

Use the **decompose-into-slices** skill to break the PRD into independent, vertically-sliced tickets. Each ticket should:

- Be independently testable (has its own acceptance criteria)
- Have a clear "done" state
- List its blockers (which tickets must complete first)
- Specify exact file changes needed

The result is a `tasks/` directory with numbered markdown files and a `README.md` with the dependency graph.

**For shared-memory:** 14 tickets produced, dependency chain:
```
01 (Auth) → 03 (Migration) → 04 (Ownership on Write) → 05 (Visibility) → ...
```

### 4. Implement — TDD, one ticket at a time

Work sequentially following the dependency graph. For each ticket:

1. Read the ticket file for exact changes
2. Write failing tests first (red)
3. Implement the changes (green)
4. Run `npm run typecheck && npm test` (refactor)
5. Mark the ticket complete in `tasks/README.md`

**Conventions used:**
- **TDD** — red-green-refactor cycle on every ticket
- **Vitest** with `D1Mock` for database, mocked Vectorize and KV
- **`req()` helper** for HTTP test requests: `(method, path, { body?, token?, userCredentials? })`
- **Single-file Worker** — all logic in `src/index.ts` (~4,200 lines)

### 5. Code Review — audit for security and correctness

After all tickets are implemented and tests pass, run a code review:

- **Security:** STRIDE analysis (timing attacks, injection, auth bypass, info leaks)
- **Correctness:** ownership checks on every mutation, visibility on every read
- **Edge cases:** empty states, race conditions, cascade deletes
- **Performance:** Vectorize batch sizes, D1 bound param limits

Fix critical and high-severity findings before shipping.

**For shared-memory:** 7 issues found and fixed:
- C1–C3: Correctness (owner_user_id preservation, visibility on /count/tags/stats, smart merge ownership)
- H1–H3: Security (constant-time HMAC, keyword search visibility, owner self-deactivation guard)
- H5: Security (LIKE wildcard escaping)

### 6. Ship — deploy and verify

1. Run full test suite: `npm test` (all 702 tests)
2. Run typecheck: `npx tsc --noEmit`
3. Commit and push to GitHub
4. Deploy to Cloudflare: `npm run deploy`
5. Smoke-test in browser: create accounts, verify visibility, test forget/recall/capture

### 7. Document — changelog and agents update

After shipping:

- Update `CHANGELOG.md` with all new features, breaking changes, and migration notes
- Update `AGENTS.md` with new architecture patterns, key functions, gotchas
- Write `CURRENT_STATE.md` in the feature folder as a post-mortem snapshot
- Lock installed skills in `skills-lock.json`

## Skills Used

| Skill | Purpose |
|-------|---------|
| `to-prod` | Convert GOAL.md → PRD.md |
| `decompose-into-slices` | Break PRD → numbered tickets |
| `implement` | Execute tickets with TDD |
| `review` | Security and correctness audit |
| `security-review` | STRIDE threat modeling |
| `tdd` | Test-driven development workflow |
| `write-docs` | Authoring CHANGELOG and AGENTS |
| `cloudflare` | Cloudflare Workers, D1, Vectorize platform |
| `workers-best-practices` | Worker-specific anti-patterns |

## Test Command Reference

```bash
npm test                        # run all 702 tests
npm test -- test/unit/edges     # run specific test file
npm run typecheck               # tsc --noEmit
npm run dev                     # local dev server
```
