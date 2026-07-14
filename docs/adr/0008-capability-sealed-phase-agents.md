---
status: accepted
date: 2026-07-14
---

# Seal Phase Agent capabilities independently from prompts

SayHi will ship versioned Research, Planning, Architecture, Implementation, Standards Review, Spec Review, Integration, and Knowledge Agents. Each Agent has a non-user-editable Capability Contract defining tools, Skills, network, repository access, spawn rights, and output schema; project Prompt Overrides may refine guidance but cannot expand that contract.

## Considered options

- Fully editable Agent Markdown, maximizing customization but allowing an accidental prompt/frontmatter edit to grant Review Agents write or spawn access.
- One generic powerful Agent switched by prompt, reducing files but defeating least privilege and role-specific output validation.
- Trust OMP Agent names alone, ignoring that project definitions can shadow Plugin definitions.

## Consequences

Agent generation, identity verification, collision diagnostics, and structured outputs are required. Users customize through a constrained path, and an Agent cannot turn a prose instruction into additional execution authority.
