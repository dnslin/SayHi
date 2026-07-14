---
status: accepted
date: 2026-07-14
---

# Use three Routes over a seven-Phase workflow

SayHi classifies work as Quick, Build, or Initiative and executes allowed subsets of Triage, Explore, Plan, Implement, Review, Integrate, and Finish. Route, lifecycle, Phase, and Step remain separate state dimensions, and every Phase has explicit entry conditions, outputs, Gates, and repair transitions.

## Considered options

- One mandatory full workflow, which is predictable but burdens small changes.
- A three-Phase Plan/Execute/Finish model, which is easy to explain but hides exploration, independent review, integration, and knowledge work inside prompts.
- A fully dynamic Skill DAG with no fixed Phases, which is flexible but cannot guarantee common quality and finish Gates.

## Consequences

The transition model and documentation are larger, and Route classification becomes a product-quality concern. Small work stays lightweight, large work receives durable governance, and recovery can identify an exact engineering position rather than infer it from artifacts.
