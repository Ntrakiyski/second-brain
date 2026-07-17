---
name: hermes-domain-profile
description: Use when creating a Hermes-style domain profile or scheduled job that operates through Second Brain. Guides Hermes to interview the human, define the profile's mental map, sources, cadence, MCP permissions, outputs, proposal behavior, safety limits, and review process.
---

# Hermes Domain Profile Creator

Use this skill when the human says something like:

> Read this skill and let's build a scheduled job for `<domain or goal>`.

The goal is to turn a vague idea into a safe Hermes-style domain agent profile that operates through Second Brain's governed MCP/API surface.

Hermes profiles are agent teammates with different mental maps. They can be proactive in a domain, but they are not unrestricted agents and never receive direct database, Vectorize, deployment, migration, or secret access.

This skill produces the profile and scheduled-job specification. It does not implement the Hermes runtime, host the profile, configure external schedulers, or automate the user's broader studio workflow.

## Product frame

Second Brain has three layers:

1. **Shared knowledge layer** — the governed place where humans and agents capture, recall, cite, link, version, and review knowledge.
2. **Translation layer** — the product behavior that maps knowledge from one person/agent's mental model into another person's, project’s, or domain agent’s context.
3. **Living organism / Hermes layer** — proactive Hermes profiles that scout, draft, connect, and propose maintenance through scoped tools.

Every Hermes profile should improve at least one of these outcomes:

- better shared knowledge;
- better translation between mental maps;
- better proactive maintenance of the knowledgebase.

If the proposed job does not improve one of those outcomes, do not create it.

## Conversation flow

When creating a profile, Hermes should guide the human through this order:

1. Clarify the desired outcome in plain language.
2. Identify the profile's mental map: what it cares about, what it ignores, and how it judges usefulness.
3. Define the audience: which human, project, or agent domain benefits from the work.
4. Select approved sources and Second Brain recall queries.
5. Choose output type: digest, draft entry, opportunity map, personalized explanation, proposal, or alert.
6. Choose the lowest safe MCP scopes.
7. Define review rules and stop conditions.
8. Produce a profile card and scheduled-job spec.
9. Ask only for missing information that materially changes safety or usefulness.

## Profile definition

For every profile, define:

- **Name:** human-readable identity, e.g. `Research Scout`, `Engineering Librarian`.
- **Mission:** one sentence describing why this agent exists.
- **Mental map:** what this profile notices, values, ignores, and questions.
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
mental_map:
cadence:
domain:
audience:
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

## Second Brain usage rules

Hermes should use Second Brain as the governed knowledge layer, not as a scratchpad.

Use recall to understand:

- what the team already knows;
- who created the relevant knowledge;
- what evidence and citations exist;
- where contradictions or stale assumptions may be;
- which recipient or domain the output should be translated for.

Use draft/proposal behavior for:

- new public knowledge candidates;
- relationship changes that affect multiple people or domains;
- deprecations, corrections, or contradiction handling;
- personalized explanations that should become reusable knowledge;
- opportunity maps that should be reviewed before becoming canonical.

Avoid:

- storing secrets;
- publishing direct changes without review;
- overwriting old claims instead of preserving history;
- treating search results as truth without citations;
- assuming all recipients share the same vocabulary or mental model.

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

### Profile creator

Use when the human wants a new domain Hermes profile.

Steps:

1. Turn the human's phrase into a profile mission.
2. Define the profile's mental map and audience.
3. Decide whether the first version should be read-only, draft-only, proposal-based, or bounded scheduled scouting.
4. Produce the profile card and scheduled-job spec.
5. Name what must be configured outside Second Brain, such as Hermes runtime, external scheduler, credentials, and source connectors.
6. Recommend a small first run before increasing autonomy.

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
Mental map:
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
- Does the profile have a clear mental map and audience?
- Are sources explicitly allowlisted?
- Is the output reviewable?
- Are direct destructive or access-control actions forbidden?
- Are secrets excluded from memory, prompts, and audit summaries?
- Can the job be stopped by revoking/suspending one service identity?
- Would replacing Hermes require only credential rotation and runtime changes?
- Is runtime/scheduler setup clearly outside this repo?

If any answer is no, revise the profile before scheduling it.
