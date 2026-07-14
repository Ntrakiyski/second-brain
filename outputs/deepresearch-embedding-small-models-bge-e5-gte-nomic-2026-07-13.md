# Deep Research: BGE-small-en-v1.5 vs E5-small vs GTE-small vs nomic-embed for short-text semantic search

Date: 2026-07-13

## Summary

For **small English embedding models** aimed at **short-text semantic search**, the evidence I found points to this ordering on MTEB-style English evaluation:

1. **nomic-ai/nomic-embed-text-v1.5**
2. **BAAI/bge-small-en-v1.5**
3. **thenlper/gte-small**
4. **intfloat/e5-small**

However, there is one important caveat:

- **nomic-embed-text-v1.5 is not natively a 384-dimensional model.** Its base embedding size is **768**. It is relevant here only because Nomic explicitly supports **Matryoshka shortening**, including **384-dim truncation**.
- The other three models are **natively 384-dimensional**.

So if your requirement is **strictly “native 384-dim encoder”**, the ranking becomes:

1. **BAAI/bge-small-en-v1.5**
2. **thenlper/gte-small**
3. **intfloat/e5-small**

## Observations

### 1) Native dimensions and context lengths

| Model | Native embedding dim | Max positions / model length | Notes |
|---|---:|---:|---|
| BAAI/bge-small-en-v1.5 | 384 | 512 | Native 384-dim BERT-family encoder |
| intfloat/e5-small | 384 | 512 | Native 384-dim BERT-family encoder |
| thenlper/gte-small | 384 | 512 | Native 384-dim BERT-family encoder |
| nomic-ai/nomic-embed-text-v1.5 | 768 | tokenizer max 8192; config shows 2048 trained positions and 8192 model max | Can be shortened via Matryoshka |

Evidence:
- `config.json` for BGE/E5/GTE each reports `hidden_size: 384` and `max_position_embeddings: 512`.
- `nomic-embed-text-v1.5` reports `hidden_size: 768`; tokenizer config reports `model_max_length: 8192`.

### 2) MTEB overall leaderboard position among the queried models

Using the MTEB legacy English leaderboard snapshot surfaced via current web search:

| Model | MTEB English overall rank | Avg score |
|---|---:|---:|
| nomic-embed-text-v1.5 | 61 | 62.28 |
| bge-small-en-v1.5 | 65 | 62.17 |
| gte-small | 81 | 61.36 |
| e5-small | 107 | 58.94 |

This supports the overall ordering:

**nomic-embed-text-v1.5 > bge-small-en-v1.5 > gte-small > e5-small**

### 3) Retrieval / semantic search evidence from model cards

For short-text semantic search, retrieval metrics matter more than classification.

- **BGE-small-en-v1.5** shows strong retrieval behavior on its model card. Example: **ArguAna NDCG@10 = 59.55**.
- **GTE-small** is competitive but a bit behind BGE on the overall leaderboard. Example: **ArguAna NDCG@10 = 55.44**.
- **E5-small** trails both on overall MTEB and on the ArguAna example surfaced in the card: **NDCG@10 = 46.69**.
- **nomic-embed-text-v1.5** scores above BGE overall on the leaderboard snapshot, but because it is 768-d native, the exact performance at **truncated 384 dims** should be treated as **likely good but not directly verified here from a uniform 4-way benchmark table**.

## Inferences

### Best choice if you want the safest 384-dim default
**BAAI/bge-small-en-v1.5** is the strongest default.

Why:
- Native **384-dim**.
- Better English MTEB overall than GTE-small and E5-small.
- Strong retrieval numbers on the official card.
- Widely used for search/retrieval workloads.

### Best choice if 384 dims can be achieved by truncation rather than native width
**nomic-ai/nomic-embed-text-v1.5** is the most promising.

Why:
- Best overall rank among the four models I checked.
- Officially supports **Matryoshka shortening**, including smaller prefixes like 384.
- Longer context window than the 512-token BERT-family small models.

But:
- It is **not a native 384-d model**.
- I did **not** verify a single apples-to-apples published benchmark table here for **nomic@384 vs BGE-small vs GTE-small vs E5-small** specifically on short-text retrieval only.

### When to prefer GTE-small
Use **GTE-small** if:
- You want a native 384-d model,
- You want something competitive with BGE-small,
- And you’re willing to trade a bit of benchmark headroom.

### When to use E5-small
Use **E5-small** mainly if:
- You already depend on E5 conventions,
- Or you need compatibility with an existing E5 pipeline.

Otherwise, based on the evidence gathered here, **BGE-small** or **GTE-small** are stronger 384-d choices.

## Recommendation

### If your requirement is “384 dimensions, short-text semantic search, small model”
Recommended order:

1. **BAAI/bge-small-en-v1.5**
2. **thenlper/gte-small**
3. **intfloat/e5-small**

### If your requirement is “best small model, and 384 dims is acceptable via truncation”
Recommended order:

1. **nomic-ai/nomic-embed-text-v1.5** (truncate to 384 if your stack supports it)
2. **BAAI/bge-small-en-v1.5**
3. **thenlper/gte-small**
4. **intfloat/e5-small**

## Gaps / Unverified

- I did **not** run a local benchmark on your exact short-text corpus.
- I did **not** verify a single official 4-way table for **short-text-only retrieval at exactly 384 dims** across all four models.
- The MTEB ranking used here comes from a surfaced **leaderboard snapshot**, not a fresh local re-run.
- For Nomic, the key unresolved question is not whether it supports 384-d truncation — it does — but **how much accuracy drops at 384 on your workload**.

## Practical next step

If you want the decision de-risked for this project, the right next experiment is a **small local benchmark** on your own short texts:
- 200–1000 query/document pairs
- Recall@k / NDCG@10 / MRR
- Compare:
  - `BAAI/bge-small-en-v1.5`
  - `thenlper/gte-small`
  - `intfloat/e5-small`
  - `nomic-ai/nomic-embed-text-v1.5` at **768** and **truncated 384**

That would resolve the main remaining uncertainty.

## Sources

- MTEB leaderboard: https://leaderboard.mteb.org/
- MTEB legacy English leaderboard snapshot: https://huggingface.co/spaces/mteb/leaderboard_legacy/blob/5fefadd0b64be978da29b3a9bdb8ce759d9c67f4/boards_data/en/data_overall/default.jsonl
- BGE-small-en-v1.5 model card: https://huggingface.co/BAAI/bge-small-en-v1.5
- BGE-small-en-v1.5 config: https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/config.json
- E5-small model card: https://huggingface.co/intfloat/e5-small
- E5-small config: https://huggingface.co/intfloat/e5-small/resolve/main/config.json
- GTE-small model card: https://huggingface.co/thenlper/gte-small
- GTE-small config: https://huggingface.co/thenlper/gte-small/resolve/main/config.json
- Nomic Embed Text v1.5 model card: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- Nomic Embed Text v1.5 config: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/config.json
- Nomic Embed Text v1.5 tokenizer config: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/tokenizer_config.json
- Nomic Matryoshka announcement: https://www.nomic.ai/news/nomic-embed-matryoshka
