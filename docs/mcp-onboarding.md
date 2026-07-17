# Second Brain MCP Onboarding

Second Brain exposes tools for memory capture, recall, graph links, citations, history, and governed proposals. Tools are the action surface. Skills are the behavior layer that teach an agent how to use those tools well.

When an MCP client connects to Second Brain, read this resource before using the tools. If the client supports installable skills, install the Second Brain MCP-use skills from this repository.

## Recommended install

Install only the public MCP-use skills:

```bash
npx skills add https://github.com/Ntrakiyski/second-brain -g -y
```

This repository also contains development skills for maintainers, but those are marked internal and are hidden from default `skills` discovery. The default install is intended for people who want to use Second Brain through MCP, not work on the Second Brain codebase.

If a client or older Skills CLI shows extra development skills, use the explicit filter:

```bash
npx skills add https://github.com/Ntrakiyski/second-brain \
  --skill second-brain-mcp-knowledgebase \
  --skill hermes-domain-profile \
  -g -y
```

Preview the public skill set:

```bash
npx skills add https://github.com/Ntrakiyski/second-brain --list
```

## Public MCP-use skills

- `second-brain-mcp-knowledgebase` — how agents should use Second Brain as a governed memory and translation layer: recall first, capture durable context, cite evidence, respect privacy, use graph links, inspect history, and route consequential actions through proposals.
- `hermes-domain-profile` — how to define a safe Hermes-style domain agent or scheduled job that operates through Second Brain with explicit sources, cadence, permissions, outputs, proposal behavior, and review boundaries.

## Tool/resource split

- Use skills for operating behavior: when to recall, what to capture, how to tag, when to use proposals, and what safety boundaries apply.
- Use MCP tools for actions: `remember`, `recall`, `append`, `update`, `passages`, `history`, `link`, `connections`, and proposal tools.
- Use MCP resources for stable context: onboarding, usage guidance, and future read-only knowledge surfaces.

## First-use behavior for agents

1. Install or load the MCP-use skills above when possible.
2. Start every conversation with an intent-framed `recall`, not bare keywords.
3. Use `hops: 1` or `hops: 2` when tracing causes, decisions, consequences, or relationships.
4. Store only durable, valuable information; never store secrets.
5. Prefer citation-backed answers and use `passages` when evidence matters.
6. Use proposal flows for uncertain, cross-user, consequential, or governed actions.

If skills cannot be installed, follow the guidance in this resource and the `second-brain-mcp-knowledgebase` skill manually.
