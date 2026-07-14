# Spaced Repetition Decay Curves for AI Agent Memory Systems

## Summary

**Bottom line:** for AI agent memory systems, a plain exponential time-decay is a reasonable **baseline retention prior**, but the stronger evidence favors a **stateful model** with at least: (1) current retention probability, (2) memory-specific stability/half-life, and (3) reinforcement from successful retrieval/use. In the human-learning literature, **SM-2** is historically important but mostly heuristic; **half-life regression (HLR)** and related stability/retrievability models are better matches when you want a learnable retention score. In recent LLM-agent work, the best-supported pattern is **not pure time decay** but **multi-factor retention scoring** combining age with utility, access frequency, redundancy/noise, and downstream success.

## Research question

How should an AI memory system model forgetting and retention: exponential decay, SM-2-style scheduling, or learned half-life / retention scoring?

## Strongest evidence

### 1) Exponential forgetting is a useful local model, but not a universal law

**Observation:** Settles & Meeder ("A Trainable Spaced Repetition Model for Language Learning," ACL 2016) model recall probability as:

\[
p = 2^{-\Delta/h}
\]

where \(\Delta\) is elapsed time and \(h\) is half-life. This is operationally attractive because it turns retention into a calibrated scalar and makes scheduling simple. They report **45%+ error reduction** over several baselines on Duolingo recall prediction.

**Observation:** SuperMemo’s later algorithm notes distinguish two regimes: (a) many within-item forgetting curves are treated as approximately exponential in retrievability/stability space, while (b) the **first-review curve over heterogeneous material** can look closer to a power law because it is a mixture over items of different difficulty and histories.

**Inference:** For AI systems, a single global decay law is probably too crude. Exponential decay is a good per-memory prior if the memory type and write history are reasonably homogeneous. Once memories are heterogeneous (facts, goals, stale UI context, user preferences, poisoned writes), you should expect departures from a single curve.

### 2) SM-2 is a scheduling heuristic, not a retention model

**Observation:** The original SM-2 family schedules next review intervals using previous recall quality and an ease factor. It was designed for practical flashcard scheduling, not as a statistically grounded model of memory state.

**Observation:** SuperMemo’s later documentation explicitly criticizes older algorithms for lacking a retrievability dimension and for using weak heuristics around spacing effects.

**Inference:** For AI memory, SM-2 is fine if you just need a simple review scheduler. It is weak if you need: calibrated retention scores, selective eviction under capacity, different memory classes, adversarial/stale-memory handling, or policy learning.

### 3) Half-life / stability models are a better fit for agent memory than raw SM-2

**Observation:** HLR learns half-life from features and past outcomes rather than using fixed hand-tuned rules. In the Duolingo study, the model uses interaction history and predicts recall directly from elapsed time plus learned half-life.

**Observation:** SuperMemo’s later SM-17 formulation explicitly separates **stability** (how long memory lasts) from **retrievability** (probability of recall now), with difficulty as a third factor.

**Inference:** This maps cleanly onto agent memory design:
- **stability** ≈ how persistent a memory should be
- **retrievability** ≈ current chance it will be useful/correct if surfaced now
- **difficulty / noise / ambiguity** ≈ how risky or costly it is to keep/use

This is a better conceptual basis for LLM memory than FIFO, LRU, or pure age decay.

### 4) Recent LLM-agent evidence favors multi-factor retention scoring over time-only decay

**Observation:** "Selective Memory Retention for Long-Horizon LLM Agents" (ICML 2026, arXiv:2606.29178) scores memory entries by interpretable features including **success, age, access frequency, redundancy, specificity, similarity, downstream utility**. On noisy-write stress tests, bounded retention resisted distractor pollution while unbounded memory degraded retrieval precision.

**Observation:** "Forget to Improve" (arXiv:2606.25115, 2026) proposes a net-value-per-byte score for keep/share/trust decisions under RAM, energy, uplink, and poisoning constraints. Reported results include lower footprint and attack success without hurting accuracy.

**Observation:** Microsoft’s "Human-Inspired Memory Architecture for LLM Agents" adds consolidation, interference-based forgetting, reconsolidation, and hybrid retrieval; at a fixed context budget it approximately matched raw retrieval accuracy while reducing stored material.

**Inference:** Current agent-memory evidence supports **retention scoring with decay as one feature**, not decay as the whole policy.

## Exponential decay vs. SM-2 for AI memory

| Criterion | Exponential decay | SM-2 | Learned half-life / retention scoring |
|---|---:|---:|---:|
| Easy to implement | High | High | Medium |
| Calibrated current retention score | High | Low | High |
| Personalized / memory-specific adaptation | Low-Medium | Medium | High |
| Handles heterogeneous memory types | Low | Low | Medium-High |
| Good for eviction / budgeting | Medium | Low | High |
| Good for safety/staleness/poison handling | Low | Low | Medium-High |
| Evidence in recent LLM-agent work | Limited | Very limited | Strongest among available options |

## Optimal half-life values by memory type

## Important uncertainty

I did **not** find a primary source that gives validated universal half-life constants for AI agent memories split into `tasks vs context vs facts`. Recent agent papers mostly study **relative retention policies** under bounded memory, not absolute half-life calibration.

So the values below are **design recommendations**, not established literature facts.

### Recommended starting priors (engineering defaults, unverified)

| Memory type | Suggested initial half-life | Why |
|---|---:|---|
| **Ephemeral context** (current page, temporary tool outputs, transient dialogue state) | **0.5–6 hours** | High staleness risk; usefulness drops fast once the local situation changes. |
| **Task-state memory** (open subtasks, plans, blockers, commitments) | **1–7 days** | Must survive pauses and resumptions, but should decay if the task completes or context shifts. |
| **User-specific facts / preferences** | **30–180 days** | Often persistent, but should still be revisited because preferences drift. |
| **Procedures / reusable workflows** | **30–365 days** | Reuse strengthens them; decay mainly guards against outdated tools/docs. |
| **Stable world facts / verified knowledge** | **90–365+ days** | Can be long-lived if provenance is strong, but should still be version-checked. |
| **Safety-sensitive or untrusted memory** | **Minutes to 7 days unless re-verified** | Short default persistence reduces poisoning/stale-risk. |

### Practical rule

Use **different priors by class**, then learn/update them from retrieval outcomes:
- successful retrieval/use -> increase half-life
- failed retrieval / contradiction / staleness -> sharply decrease half-life
- repeated external confirmation -> increase half-life and trust
- detected noise/redundancy -> decrease value even if recent

## Retention scoring for LLM memory systems

A defensible retention score is:

\[
\text{retain}(m) = w_u U + w_r R + w_f F + w_s S - w_a A - w_d D - w_h H
\]

where for memory \(m\):
- \(U\): downstream utility / success contribution
- \(R\): retrieval frequency
- \(F\): factual confidence / provenance strength
- \(S\): specificity or distinctiveness
- \(A\): age or time-since-last-success (possibly via exponential half-life)
- \(D\): redundancy with other memories
- \(H\): harm/risk score (poisoning, privacy, stale-danger)

Then define current recall prior as:

\[
P(\text{useful now} \mid m) = 2^{-\Delta / h_m}
\]

with memory-specific half-life \(h_m\), and let the final keep/evict/share decision depend on both this prior and the utility/risk terms.

## Recommended architecture

1. **Classify each memory at write time**: context / task / fact / preference / procedure / untrusted.
2. **Assign class-specific initial half-life priors**.
3. **Track per-memory state**:
   - created_at
   - last_retrieved_at
   - last_success_at
   - retrieval_count
   - contradiction_count
   - provenance/trust
   - redundancy cluster
4. **Compute current retention prior** using an exponential or half-life model.
5. **Update half-life online** from successes/failures, closer to HLR/SM-17 than SM-2.
6. **Run bounded retention** with utility/risk-aware eviction rather than pure age decay.
7. **Consolidate**: dedupe, summarize, merge similar episodic traces into semantic memory.
8. **Re-verify long-lived facts** instead of assuming permanence.

## Disagreements / gaps in evidence

- Human memory literature does **not** imply a single universal forgetting curve for all materials; mixtures can look power-law-like.
- Recent LLM memory papers strongly motivate forgetting/retention policies, but many are still early and benchmark-specific.
- I found **no strong primary-source evidence** for exact optimal half-life constants by AI memory type.
- Evidence for SM-2 specifically in modern LLM-agent memory systems is weak; it is mostly a historical baseline or analogy.

## Recommended next steps

1. Treat **exponential half-life** as the base retention prior.
2. Do **not** use SM-2 alone as the memory manager.
3. Build a **memory-type-specific HLR-style model** or at least a multi-factor retention score.
4. Evaluate on synthetic noise/staleness benchmarks, not just clean retrieval tasks.
5. Measure separately for:
   - precision@k of recalled memories
   - task success after long interruptions
   - stale-memory harm rate
   - poison/injection success rate
   - memory bytes/token budget

## Blocked / unverified

- `alpha_search` failed (`fetch failed`), so this brief relies on web-accessed primary papers/docs instead of alphaXiv retrieval.
- Exact "optimal" half-life values for `tasks vs context vs facts` remain **unverified**; recommendations above are engineering priors.

## Sources

- Settles, B. & Meeder, B. "A Trainable Spaced Repetition Model for Language Learning" (ACL 2016). https://aclanthology.org/P16-1174/ ; PDF mirror used in extraction: https://aclanthology.org/anthology-files/pdf/P/P16/P16-1174.pdf
- Wozniak / SuperMemo algorithm documentation (SM-17). https://www.super-memory.org/archive/help/smalg.htm
- SuperMemo spaced repetition overview. https://www.supermemo.com/en/blog/spaced-repetition-in-learning
- Kumbam et al. "Selective Memory Retention for Long-Horizon LLM Agents" (ICML 2026), arXiv:2606.29178. https://arxiv.org/abs/2606.29178
- Wu et al. "Forget to Improve: On-Device LLM-Agent Continual Learning via Budget-Curated Memory" (2026), arXiv:2606.25115. https://arxiv.org/abs/2606.25115
- Gu et al. "FSFM: A Biologically-Inspired Framework for Selective Forgetting of Agent Memory" (2026), arXiv:2604.20300. https://arxiv.org/abs/2604.20300
- Du et al. "Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers" (2026), arXiv:2603.07670. https://arxiv.org/abs/2603.07670
- Microsoft Research, "Human-Inspired Memory Architecture for LLM Agents". https://www.microsoft.com/en-us/research/publication/human-inspired-memory-architecture-for-llm-agents/
- Nature Reviews Psychology review page/content fetched during research: https://www.nature.com/articles/s44159-022-00089-1.pdf
