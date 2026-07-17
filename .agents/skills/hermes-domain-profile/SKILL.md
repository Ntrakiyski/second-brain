---
name: hermes-domain-profile
description: Use when creating or configuring a Hermes-style domain agent profile or scheduled job for Second Brain. Guides agents to define domain, scope, sources, cadence, MCP permissions, outputs, proposal behavior, safety limits, and review process.
---

# Hermes Domain Profile

Use this skill when the human says something like:

> Read this skill and let's build a scheduled job for `<domain or goal>`.

The goal is to turn an idea into a safe Hermes-style domain agent profile that operates through Second Brain's governed MCP/API surface.

Hermes profiles are agent teammates. They can be proactive in a domain, but they are not unrestricted agents and never receive direct database, Vectorize, deployment, migration, or secret access.

## Profile definition

For every profile, define:

- **Name:** human-readable identity, e.g. `Research Scout`, `Engineering Librarian`.
- **Mission:** one sentence describing why this agent exists.
- **Domain:** topics/projects/sources it is responsible for.
- **Audience:** who benefits from its work.
- **Cadence:** manual, hourly, daily, weekly, or event-triggered.
- **Inputs:** approved sources and Second Brain recall queries.
- **Outputs:** draft, opportunity map, personalized explanation, proposal, digest, or alert.
- **Allowed actions:** read, draft, propose, inspect proposals.
- **Forbidden actions:** direct publish, hard forget, permissions, credentials, deployment, direct storage.
- **Reviewer:** human or group responsible for approving proposals.
- **Success criteria:** what makes this job useful.
- **Stop conditions:** when it should do nothing.

## Default scopes

Start with the smallest useful scope set:

- `memory:read`
- `proposal:read`
- `audit:write`
- `run:write`

Add only if needed:

- `memory:draft` — for private draft candidate entries.
- `memory:propose` — for consequential memory changes.
- `proposal:create` — for human-reviewable proposals.

Avoid by default:

- `memory:execute-approved`
- `proposal:execute-approved`

Never grant:

- hard forget;
- service identity administration;
- deployment/migration/storage access;
- direct D1/Vectorize/R2 credentials.

## Scheduled job builder

When the human provides a goal, produce this job spec:

```yaml
profile_name:
mission:
cadence:
domain:
source_allowlist:
second_brain_queries:
actions_allowed:
actions_forbidden:
output_type:
reviewer:
idempotency_key_pattern:
budget:
success_criteria:
stop_conditions:
failure_mode:
```

Then ask only for missing information that materially changes safety or usefulness.

## Workflow patterns

### Research scout

Use when the agent watches external sources and brings back useful knowledge.

Steps:

1. Recall existing knowledge about the topic.
2. Search only approved sources.
3. Extract source-backed claims.
4. Compare with current knowledge.
5. Draft private candidates or create proposals.
6. Include citations and confidence.
7. Produce a short digest.

### Opportunity mapper

Use when new knowledge should be mapped to people, projects, or agent domains.

Steps:

1. Identify the source entry and why it mattered to the actor who captured it.
2. Recall related entries for each target person/domain.
3. Explain how the source knowledge may be useful in each target context.
4. Suggest new links, use cases, and questions.
5. Create proposals rather than direct public changes.

### Personalized explanation

Use when the same knowledge needs a different explanation for different recipients.

Steps:

1. Recall recipient context, goals, vocabulary, and prior notes.
2. Explain the knowledge in that recipient's language.
3. Highlight what is new, useful, or risky for them.
4. Avoid assuming they share the source actor's mental map.
5. Suggest next readings or experiments.

### Quality critic

Use when the agent checks weak claims or stale assumptions.

Steps:

1. Recall canonical decisions and claims.
2. Find missing citations, contradictions, stale dates, or low confidence.
3. Propose clarification, deprecation, or follow-up research.
4. Never silently overwrite the old claim.

## Output templates

### Profile card

```text
Name:
Mission:
Domain:
Cadence:
Sources:
Second Brain access:
Outputs:
Human reviewer:
Safety limits:
First scheduled job:
```

### Opportunity map

```text
Source discovery:
Why the source actor cared:
Who else may benefit:
Recipient-specific uses:
Related knowledge:
Missing evidence:
Suggested proposals:
```

### Morning/domain digest

```text
What changed:
Why it matters:
New opportunities:
Contradictions or risks:
Proposals awaiting review:
Recommended human action:
```

## Safety checks before finalizing a job

- Does the job have a clear domain and stop condition?
- Are sources explicitly allowlisted?
- Is the output reviewable?
- Are direct destructive or access-control actions forbidden?
- Are secrets excluded from memory, prompts, and audit summaries?
- Can the job be stopped by revoking/suspending one service identity?
- Would replacing Hermes require only credential rotation and runtime changes?

If any answer is no, revise the profile before scheduling it.

