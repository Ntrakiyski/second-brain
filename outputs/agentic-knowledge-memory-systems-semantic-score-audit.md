# Score Audit: agentic knowledge memory systems with semantic search knowledge graphs and contradiction detection

Generated: 2026-07-13T18:31:22.485Z
Source: OpenAlex Works API

## What This Audit Explains

This file is the per-paper explanation layer for PaperRank. It shows how each component contributed to `ReadFirstScore`, which evidence was visible, which evidence was missing, and what still needs scientific verification.

## Score Formula

`ReadFirstScore` is a weighted average over available components. Missing components are excluded from the denominator and the remaining weights are normalized for that paper.

| Component | Base Weight | Scientific Role |
| --- | ---: | --- |
| Topical relevance | 0.30 | Keeps the ranking anchored to the query topic. |
| Citation impact | 0.20 | Uses OpenAlex normalized citation percentile when available, otherwise local citation count fallback. |
| Graph prestige | 0.20 | Uses PageRank-style local citation-network influence when citation edges exist. |
| Citation velocity | 0.10 | Separates recent attention rate from lifetime citation count. |
| Methodology quality | 0.10 | Screens for visible experimental, dataset, baseline, metric, and validation evidence. |
| Reproducibility | 0.10 | Screens for open access, PDF, code, dataset, artifact, and reproduction-path evidence. |

## Ranked Paper Audits

### #1 Knowledge graph refinement: A survey of approaches and evaluation methods

- Paper ID: `W2300469216`
- ReadFirstScore: 67.4/100
- Year: 2016
- Field role: foundation, bridge in Data Quality and Management. ReadFirst 67.4/100; foundation signal from impact 100.0, graph 100.0, local in-degree 3; bridge signal from 3 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 47.8 | 0.300 | 14.3 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 100.0 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 100.0 | 0.200 | 20.0 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 80.1 | 0.100 | 8.0 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: graph prestige 100.0/100 (medium confidence)
- Supporting signal: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: citation impact 100.0/100 (high confidence)
- Supporting signal: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: citation velocity 80.1/100 (medium confidence)
- Verification gap: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: methodology quality 21.0/100
- Verification gap: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: reproducibility 30.0/100
- Verification gap: #1 Knowledge graph refinement: A survey of approaches and evaluation methods: topical relevance 47.8/100

#### Source Evidence

- methodology: marker `evaluation` in display_name — "Knowledge graph refinement: A survey of approaches and evaluation methods"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #2 Detection and Resolution of Rumours in Social Media

- Paper ID: `W2610676001`
- ReadFirstScore: 52.2/100
- Year: 2018
- Field role: foundation, bridge in Misinformation and Its Impacts. ReadFirst 52.2/100; foundation signal from impact 100.0, graph 45.6, local in-degree 1; bridge signal from 1 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 38.5 | 0.300 | 11.5 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 100.0 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 45.6 | 0.200 | 9.1 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 71.4 | 0.100 | 7.1 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 14.0 | 0.100 | 1.4 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #2 Detection and Resolution of Rumours in Social Media: citation impact 100.0/100 (high confidence)
- Supporting signal: #2 Detection and Resolution of Rumours in Social Media: citation velocity 71.4/100 (medium confidence)
- Supporting signal: #2 Detection and Resolution of Rumours in Social Media: graph prestige 45.6/100 (medium confidence)
- Verification gap: #2 Detection and Resolution of Rumours in Social Media: methodology quality 14.0/100
- Verification gap: #2 Detection and Resolution of Rumours in Social Media: reproducibility 30.0/100
- Verification gap: #2 Detection and Resolution of Rumours in Social Media: topical relevance 38.5/100

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #3 Construction of Knowledge Graphs: Current State and Challenges

- Paper ID: `W4401807469`
- ReadFirstScore: 52.1/100
- Year: 2024
- Field role: foundation, bridge in Data Quality and Management. ReadFirst 52.1/100; foundation signal from impact 99.8, graph 32.0, local in-degree 0; bridge signal from 2 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 53.0 | 0.300 | 15.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.8 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 54.4 | 0.100 | 5.4 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 14.0 | 0.100 | 1.4 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #3 Construction of Knowledge Graphs: Current State and Challenges: citation impact 99.8/100 (high confidence)
- Supporting signal: #3 Construction of Knowledge Graphs: Current State and Challenges: citation velocity 54.4/100 (medium confidence)
- Supporting signal: #3 Construction of Knowledge Graphs: Current State and Challenges: topical relevance 53.0/100 (high confidence)
- Verification gap: #3 Construction of Knowledge Graphs: Current State and Challenges: methodology quality 14.0/100
- Verification gap: #3 Construction of Knowledge Graphs: Current State and Challenges: reproducibility 30.0/100
- Verification gap: #3 Construction of Knowledge Graphs: Current State and Challenges: graph prestige 32.0/100

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #4 Detection and Resolution of Rumours in Social Media: A Survey

- Paper ID: `W3125491592`
- ReadFirstScore: 50.3/100
- Year: 2017
- Field role: foundation, bridge in Misinformation and Its Impacts. ReadFirst 50.3/100; foundation signal from impact 88.1, graph 45.6, local in-degree 1; bridge signal from 1 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 39.5 | 0.300 | 11.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 88.1 | 0.200 | 17.6 | medium | OpenAlex did not provide a normalized percentile, so this falls back to candidate-local log citation count. |
| graph prestige | yes | 45.6 | 0.200 | 9.1 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 73.2 | 0.100 | 7.3 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 14.0 | 0.100 | 1.4 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #4 Detection and Resolution of Rumours in Social Media: A Survey: citation impact 88.1/100 (medium confidence)
- Supporting signal: #4 Detection and Resolution of Rumours in Social Media: A Survey: citation velocity 73.2/100 (medium confidence)
- Supporting signal: #4 Detection and Resolution of Rumours in Social Media: A Survey: graph prestige 45.6/100 (medium confidence)
- Verification gap: #4 Detection and Resolution of Rumours in Social Media: A Survey: methodology quality 14.0/100
- Verification gap: #4 Detection and Resolution of Rumours in Social Media: A Survey: reproducibility 30.0/100
- Verification gap: #4 Detection and Resolution of Rumours in Social Media: A Survey: topical relevance 39.5/100

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges

- Paper ID: `W4206484811`
- ReadFirstScore: 48.6/100
- Year: 2022
- Field role: foundation, bridge in Multimodal Machine Learning Applications. ReadFirst 48.6/100; foundation signal from impact 100.0, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 19.8 | 0.300 | 5.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 100.0 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 100.0 | 0.100 | 10.0 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 33.0 | 0.100 | 3.3 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: citation velocity 100.0/100 (medium confidence)
- Supporting signal: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: citation impact 100.0/100 (high confidence)
- Supporting signal: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: methodology quality 33.0/100 (medium confidence)
- Verification gap: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: topical relevance 19.8/100
- Verification gap: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: reproducibility 30.0/100
- Verification gap: #5 A Metaverse: Taxonomy, Components, Applications, and Open Challenges: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `analysis` in abstract_inverted_index — "rather than marketing or hardware approach to conduct a comprehensive analysis. Furthermore, we describe essential methods based on three components"
- methodology: marker `limitation` in abstract_inverted_index — "in the domain of films, games, and studies. Finally, we summarize the limitations and directions for implementing the immersive Metaverse as social inf"
- methodology: marker `limitations` in abstract_inverted_index — "in the domain of films, games, and studies. Finally, we summarize the limitations and directions for implementing the immersive Metaverse as social inf"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #6 Neurosymbolic AI: the 3rd wave

- Paper ID: `W3113149630`
- ReadFirstScore: 48.3/100
- Year: 2023
- Field role: foundation, frontier, bridge in Neural Networks and Applications. ReadFirst 48.3/100; foundation signal from impact 99.9, graph 32.0, local in-degree 0; frontier signal from year 2023 and velocity 75.4; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 21.7 | 0.330 | 7.2 | medium | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.9 | 0.220 | 22.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.220 | 7.0 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 75.4 | 0.110 | 8.3 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | no | n/a | n/a | n/a | low | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.110 | 3.3 | low | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #6 Neurosymbolic AI: the 3rd wave: citation impact 99.9/100 (high confidence)
- Supporting signal: #6 Neurosymbolic AI: the 3rd wave: citation velocity 75.4/100 (medium confidence)
- Supporting signal: #6 Neurosymbolic AI: the 3rd wave: graph prestige 32.0/100 (medium confidence)
- Verification gap: #6 Neurosymbolic AI: the 3rd wave: methodology quality unavailable
- Verification gap: #6 Neurosymbolic AI: the 3rd wave: topical relevance 21.7/100
- Verification gap: #6 Neurosymbolic AI: the 3rd wave: reproducibility 30.0/100

#### Missing Components

- methodology quality: Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation.

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #7 Extracting semantically enriched events from biomedical literature

- Paper ID: `W2051547811`
- ReadFirstScore: 47.9/100
- Year: 2012
- Field role: foundation, bridge in Biomedical Text Mining and Ontologies. ReadFirst 47.9/100; foundation signal from impact 94.9, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 43.6 | 0.300 | 13.1 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 94.9 | 0.200 | 19.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 29.3 | 0.100 | 2.9 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 35.0 | 0.100 | 3.5 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #7 Extracting semantically enriched events from biomedical literature: citation impact 94.9/100 (high confidence)
- Supporting signal: #7 Extracting semantically enriched events from biomedical literature: topical relevance 43.6/100 (high confidence)
- Supporting signal: #7 Extracting semantically enriched events from biomedical literature: methodology quality 35.0/100 (medium confidence)
- Verification gap: #7 Extracting semantically enriched events from biomedical literature: citation velocity 29.3/100
- Verification gap: #7 Extracting semantically enriched events from biomedical literature: reproducibility 30.0/100
- Verification gap: #7 Extracting semantically enriched events from biomedical literature: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `result` in abstract_inverted_index — "things, whether an event represents a fact, hypothesis, experimental result or analysis of results, whether it describes new or previously report"
- methodology: marker `analysis` in abstract_inverted_index — "hether an event represents a fact, hypothesis, experimental result or analysis of results, whether it describes new or previously reported knowledge"
- methodology: marker `result` in abstract_inverted_index — "ent represents a fact, hypothesis, experimental result or analysis of results, whether it describes new or previously reported knowledge, and wheth"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #8 Semantic Systems. In the Era of Knowledge Graphs

- Paper ID: `W3123733941`
- ReadFirstScore: 47.2/100
- Year: 2020
- Field role: foundation, bridge in Semantic Web and Ontologies. ReadFirst 47.2/100; foundation signal from impact 83.8, graph 32.0, local in-degree 0; bridge signal from 1 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 59.3 | 0.300 | 17.8 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 83.8 | 0.200 | 16.8 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 11.8 | 0.100 | 1.2 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #8 Semantic Systems. In the Era of Knowledge Graphs: citation impact 83.8/100 (high confidence)
- Supporting signal: #8 Semantic Systems. In the Era of Knowledge Graphs: topical relevance 59.3/100 (high confidence)
- Supporting signal: #8 Semantic Systems. In the Era of Knowledge Graphs: graph prestige 32.0/100 (medium confidence)
- Verification gap: #8 Semantic Systems. In the Era of Knowledge Graphs: citation velocity 11.8/100
- Verification gap: #8 Semantic Systems. In the Era of Knowledge Graphs: methodology quality 21.0/100
- Verification gap: #8 Semantic Systems. In the Era of Knowledge Graphs: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `result` in abstract_inverted_index — "2020). SEMANTiCS offers a forum for the exchange of latest scientific results in semantic systems and complements these topics with new research ch"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids

- Paper ID: `W3142044733`
- ReadFirstScore: 46.7/100
- Year: 2021
- Field role: foundation, bridge in Network Security and Intrusion Detection. ReadFirst 46.7/100; foundation signal from impact 98.3, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 34.4 | 0.300 | 10.3 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 98.3 | 0.200 | 19.7 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 52.1 | 0.100 | 5.2 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: citation impact 98.3/100 (high confidence)
- Supporting signal: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: citation velocity 52.1/100 (medium confidence)
- Supporting signal: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: topical relevance 34.4/100 (high confidence)
- Verification gap: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: methodology quality 21.0/100
- Verification gap: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: reproducibility 30.0/100
- Verification gap: #9 A Review of Rule Learning-Based Intrusion Detection Systems and Their Prospects in Smart Grids: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `analysis` in abstract_inverted_index — "p security operation. The present work provides a systematic and deep analysis of rule learning techniques and their suitability for IDS in SG. Besi"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #10 Neural Architecture Search for Transformers: A Survey

- Paper ID: `W4312257891`
- ReadFirstScore: 46.2/100
- Year: 2022
- Field role: foundation, bridge in Advanced Neural Network Applications. ReadFirst 46.2/100; foundation signal from impact 98.7, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 28.1 | 0.300 | 8.4 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 98.7 | 0.200 | 19.7 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 51.9 | 0.100 | 5.2 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 28.0 | 0.100 | 2.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 37.0 | 0.100 | 3.7 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #10 Neural Architecture Search for Transformers: A Survey: citation impact 98.7/100 (high confidence)
- Supporting signal: #10 Neural Architecture Search for Transformers: A Survey: citation velocity 51.9/100 (medium confidence)
- Supporting signal: #10 Neural Architecture Search for Transformers: A Survey: reproducibility 37.0/100 (medium confidence)
- Verification gap: #10 Neural Architecture Search for Transformers: A Survey: methodology quality 28.0/100
- Verification gap: #10 Neural Architecture Search for Transformers: A Survey: topical relevance 28.1/100
- Verification gap: #10 Neural Architecture Search for Transformers: A Survey: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `analysis` in abstract_inverted_index — "are the de facto choice in several language tasks, such as Sentiment Analysis and Text Summarization, replacing Long Short Term Memory (LSTM) model"
- methodology: marker `dataset` in abstract_inverted_index — "me. The design pipeline of a neural architecture for a given task and dataset is extremely challenging as it requires expertise in several interdis"
- reproducibility: marker `dataset` in abstract_inverted_index — "me. The design pipeline of a neural architecture for a given task and dataset is extremely challenging as it requires expertise in several interdis"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring

- Paper ID: `W2009434747`
- ReadFirstScore: 45.9/100
- Year: 2014
- Field role: foundation, bridge in Intelligent Tutoring Systems and Adaptive Learning. ReadFirst 45.9/100; foundation signal from impact 99.2, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 22.9 | 0.330 | 7.5 | medium | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.2 | 0.220 | 21.8 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.220 | 7.0 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 52.5 | 0.110 | 5.8 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | no | n/a | n/a | n/a | low | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.110 | 3.3 | low | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: citation impact 99.2/100 (high confidence)
- Supporting signal: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: citation velocity 52.5/100 (medium confidence)
- Supporting signal: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: graph prestige 32.0/100 (medium confidence)
- Verification gap: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: methodology quality unavailable
- Verification gap: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: topical relevance 22.9/100
- Verification gap: #11 AutoTutor and Family: A Review of 17 Years of Natural Language Tutoring: reproducibility 30.0/100

#### Missing Components

- methodology quality: Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation.

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications

- Paper ID: `W3188576818`
- ReadFirstScore: 45.4/100
- Year: 2021
- Field role: foundation, bridge in Network Security and Intrusion Detection. ReadFirst 45.4/100; foundation signal from impact 95.7, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 32.2 | 0.300 | 9.7 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 95.7 | 0.200 | 19.1 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 37.1 | 0.100 | 3.7 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 35.0 | 0.100 | 3.5 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: citation impact 95.7/100 (high confidence)
- Supporting signal: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: citation velocity 37.1/100 (medium confidence)
- Supporting signal: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: methodology quality 35.0/100 (medium confidence)
- Verification gap: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: reproducibility 30.0/100
- Verification gap: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: graph prestige 32.0/100
- Verification gap: #12 A Review of Intrusion Detection Systems in RPL Routing Protocol Based on Machine Learning for Internet of Things Applications: topical relevance 32.2/100

#### Source Evidence

- methodology: marker `result` in abstract_inverted_index — "and then continues sending DIO messages using the trickle timer. As a result, DODAG begins at the root and eventually extends to encompass the who"
- methodology: marker `analysis` in abstract_inverted_index — "environments underscore the importance of research in this area. The analysis is done using research sources of “Google Scholar,” “Crossref,” “Scop"
- methodology: marker `evaluation` in abstract_inverted_index — "e Scholar,” “Crossref,” “Scopus,” and “Web of Science” resources. The evaluations are assessed for studies from 2016 to 2021. The results are illustrat"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle

- Paper ID: `W3085880068`
- ReadFirstScore: 45.0/100
- Year: 2020
- Field role: foundation, bridge in Aesthetic Perception and Analysis. ReadFirst 45.0/100; foundation signal from impact 96.5, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 25.0 | 0.330 | 8.3 | medium | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 96.5 | 0.220 | 21.2 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.220 | 7.0 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 43.3 | 0.110 | 4.8 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | no | n/a | n/a | n/a | low | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.110 | 3.3 | low | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: citation impact 96.5/100 (high confidence)
- Supporting signal: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: citation velocity 43.3/100 (medium confidence)
- Supporting signal: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: graph prestige 32.0/100 (medium confidence)
- Verification gap: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: methodology quality unavailable
- Verification gap: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: topical relevance 25.0/100
- Verification gap: #13 “Stopping for knowledge”: The sense of beauty in the perception-action cycle: reproducibility 30.0/100

#### Missing Components

- methodology quality: Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation.

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research

- Paper ID: `W3174385379`
- ReadFirstScore: 44.8/100
- Year: 2021
- Field role: foundation, bridge in Smart Agriculture and AI. ReadFirst 44.8/100; foundation signal from impact 99.8, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 23.0 | 0.300 | 6.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.8 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 64.6 | 0.100 | 6.5 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: citation impact 99.8/100 (high confidence)
- Supporting signal: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: citation velocity 64.6/100 (medium confidence)
- Supporting signal: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: graph prestige 32.0/100 (medium confidence)
- Verification gap: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: methodology quality 21.0/100
- Verification gap: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: topical relevance 23.0/100
- Verification gap: #14 Computer Vision, IoT and Data Fusion for Crop Disease Detection Using Machine Learning: A Survey and Ongoing Research: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `analysis` in abstract_inverted_index — "achine learning approaches to build models for detection, prediction, analysis, assessment, etc. However, the increasing number and diversity of res"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #15 Unsupervised Anomaly Detection in Knowledge Graphs

- Paper ID: `W4206928079`
- ReadFirstScore: 44.4/100
- Year: 2021
- Field role: foundation, bridge in Data Quality and Management. ReadFirst 44.4/100; foundation signal from impact 83.1, graph 45.6, local in-degree 1; bridge signal from 1 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 39.6 | 0.300 | 11.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 83.1 | 0.200 | 16.6 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 45.6 | 0.200 | 9.1 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 16.7 | 0.100 | 1.7 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #15 Unsupervised Anomaly Detection in Knowledge Graphs: citation impact 83.1/100 (high confidence)
- Supporting signal: #15 Unsupervised Anomaly Detection in Knowledge Graphs: graph prestige 45.6/100 (medium confidence)
- Supporting signal: #15 Unsupervised Anomaly Detection in Knowledge Graphs: topical relevance 39.6/100 (high confidence)
- Verification gap: #15 Unsupervised Anomaly Detection in Knowledge Graphs: citation velocity 16.7/100
- Verification gap: #15 Unsupervised Anomaly Detection in Knowledge Graphs: methodology quality 21.0/100
- Verification gap: #15 Unsupervised Anomaly Detection in Knowledge Graphs: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `evaluation` in abstract_inverted_index — "n the four knowledge graphs YAGO-1, KBpedia, Wikidata, and DSKG. This evaluation demonstrates that our approach is well suited to identify anomalies i"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #16 Neural Networks in Big Data and Web Search

- Paper ID: `W2906927267`
- ReadFirstScore: 43.4/100
- Year: 2018
- Field role: foundation, bridge in Web Data Mining and Analysis. ReadFirst 43.4/100; foundation signal from impact 97.4, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 30.0 | 0.300 | 9.0 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 97.4 | 0.200 | 19.5 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 27.0 | 0.100 | 2.7 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 28.0 | 0.100 | 2.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #16 Neural Networks in Big Data and Web Search: citation impact 97.4/100 (high confidence)
- Supporting signal: #16 Neural Networks in Big Data and Web Search: graph prestige 32.0/100 (medium confidence)
- Supporting signal: #16 Neural Networks in Big Data and Web Search: topical relevance 30.0/100 (high confidence)
- Verification gap: #16 Neural Networks in Big Data and Web Search: citation velocity 27.0/100
- Verification gap: #16 Neural Networks in Big Data and Web Search: methodology quality 28.0/100
- Verification gap: #16 Neural Networks in Big Data and Web Search: topical relevance 30.0/100

#### Source Evidence

- methodology: marker `result` in abstract_inverted_index — "al Web users should not stay confident that the products suggested or results displayed are either complete or relevant to their search aspirations"
- methodology: marker `result` in abstract_inverted_index — "r-click. The essential user experience is the self-assurance that the results provided are relevant and exhaustive. This survey paper presents a re"
- methodology: marker `analysis` in abstract_inverted_index — "b search that covers web search engines, ranking algorithms, citation analysis and recommender systems. The use of artificial intelligence (AI) base"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection

- Paper ID: `W3207701354`
- ReadFirstScore: 42.5/100
- Year: 2021
- Field role: foundation, bridge in Cybercrime and Law Enforcement Studies. ReadFirst 42.5/100; foundation signal from impact 99.3, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 16.6 | 0.300 | 5.0 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.3 | 0.200 | 19.9 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 47.6 | 0.100 | 4.8 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 28.0 | 0.100 | 2.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 37.0 | 0.100 | 3.7 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: citation impact 99.3/100 (high confidence)
- Supporting signal: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: citation velocity 47.6/100 (medium confidence)
- Supporting signal: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: reproducibility 37.0/100 (medium confidence)
- Verification gap: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: topical relevance 16.6/100
- Verification gap: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: methodology quality 28.0/100
- Verification gap: #17 A Human-Centered Systematic Literature Review of the Computational Approaches for Online Sexual Risk Detection: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `dataset` in abstract_inverted_index — "o prevent victimization before it occurs. Many studies rely on public datasets (82%) and third-party annotators (33%) to establish ground truth and"
- methodology: marker `evaluation` in abstract_inverted_index — "majority of this work (78%) mostly focused on algorithmic performance evaluation of their model and rarely (4%) evaluate these systems with real users"
- reproducibility: marker `dataset` in abstract_inverted_index — "o prevent victimization before it occurs. Many studies rely on public datasets (82%) and third-party annotators (33%) to establish ground truth and"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #18 Machine Learning for Refining Knowledge Graphs: A Survey

- Paper ID: `W4390880258`
- ReadFirstScore: 42.4/100
- Year: 2024
- Field role: foundation, bridge in Advanced Graph Neural Networks. ReadFirst 42.4/100; foundation signal from impact 94.9, graph 32.0, local in-degree 0; bridge signal from 1 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 27.1 | 0.300 | 8.1 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 94.9 | 0.200 | 19.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 30.5 | 0.100 | 3.1 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 37.0 | 0.100 | 3.7 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #18 Machine Learning for Refining Knowledge Graphs: A Survey: citation impact 94.9/100 (high confidence)
- Supporting signal: #18 Machine Learning for Refining Knowledge Graphs: A Survey: reproducibility 37.0/100 (medium confidence)
- Supporting signal: #18 Machine Learning for Refining Knowledge Graphs: A Survey: graph prestige 32.0/100 (medium confidence)
- Verification gap: #18 Machine Learning for Refining Knowledge Graphs: A Survey: methodology quality 21.0/100
- Verification gap: #18 Machine Learning for Refining Knowledge Graphs: A Survey: topical relevance 27.1/100
- Verification gap: #18 Machine Learning for Refining Knowledge Graphs: A Survey: citation velocity 30.5/100

#### Source Evidence

- methodology: marker `dataset` in abstract_inverted_index — "nt according to the kind of operations in KG refinement, the training datasets, mode of learning, and process multiplicity. Furthermore, the survey"
- reproducibility: marker `dataset` in abstract_inverted_index — "nt according to the kind of operations in KG refinement, the training datasets, mode of learning, and process multiplicity. Furthermore, the survey"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #19 A comprehensive survey on machine learning approaches for fake news detection

- Paper ID: `W4388524030`
- ReadFirstScore: 42.3/100
- Year: 2023
- Field role: foundation, frontier, bridge in Misinformation and Its Impacts. ReadFirst 42.3/100; foundation signal from impact 99.9, graph 32.0, local in-degree 0; frontier signal from year 2023 and velocity 57.5; bridge signal from 2 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 14.6 | 0.300 | 4.4 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.9 | 0.200 | 20.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 57.5 | 0.100 | 5.7 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 21.0 | 0.100 | 2.1 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 37.0 | 0.100 | 3.7 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #19 A comprehensive survey on machine learning approaches for fake news detection: citation impact 99.9/100 (high confidence)
- Supporting signal: #19 A comprehensive survey on machine learning approaches for fake news detection: citation velocity 57.5/100 (medium confidence)
- Supporting signal: #19 A comprehensive survey on machine learning approaches for fake news detection: reproducibility 37.0/100 (medium confidence)
- Verification gap: #19 A comprehensive survey on machine learning approaches for fake news detection: topical relevance 14.6/100
- Verification gap: #19 A comprehensive survey on machine learning approaches for fake news detection: methodology quality 21.0/100
- Verification gap: #19 A comprehensive survey on machine learning approaches for fake news detection: graph prestige 32.0/100

#### Source Evidence

- methodology: marker `dataset` in abstract_inverted_index — "the review summarises the characteristics of fake news, commonly used datasets, and the methodologies employed in existing studies. Furthermore, the"
- reproducibility: marker `dataset` in abstract_inverted_index — "the review summarises the characteristics of fake news, commonly used datasets, and the methodologies employed in existing studies. Furthermore, the"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models

- Paper ID: `W4412465717`
- ReadFirstScore: 41.2/100
- Year: 2025
- Field role: foundation, bridge in Topic Modeling. ReadFirst 41.2/100; foundation signal from impact 99.2, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 19.8 | 0.300 | 5.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 99.2 | 0.200 | 19.8 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 34.3 | 0.100 | 3.4 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 26.0 | 0.100 | 2.6 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: citation impact 99.2/100 (high confidence)
- Supporting signal: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: citation velocity 34.3/100 (medium confidence)
- Supporting signal: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: graph prestige 32.0/100 (medium confidence)
- Verification gap: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: topical relevance 19.8/100
- Verification gap: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: methodology quality 26.0/100
- Verification gap: #20 Practices, opportunities and challenges in the fusion of knowledge graphs and large language models: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `limitation` in abstract_inverted_index — "uage Models (LLMs) leverages their complementary strengths to address limitations of both technologies. This paper explores integration practices, oppo"
- methodology: marker `limitations` in abstract_inverted_index — "uage Models (LLMs) leverages their complementary strengths to address limitations of both technologies. This paper explores integration practices, oppo"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system

- Paper ID: `W4311405210`
- ReadFirstScore: 39.5/100
- Year: 2022
- Field role: foundation, bridge in Evacuation and Crowd Dynamics. ReadFirst 39.5/100; foundation signal from impact 98.8, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 5.2 | 0.330 | 1.7 | medium | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 98.8 | 0.220 | 21.7 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.220 | 7.0 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 47.8 | 0.110 | 5.3 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | no | n/a | n/a | n/a | low | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.110 | 3.3 | low | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: citation impact 98.8/100 (high confidence)
- Supporting signal: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: citation velocity 47.8/100 (medium confidence)
- Supporting signal: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: graph prestige 32.0/100 (medium confidence)
- Verification gap: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: methodology quality unavailable
- Verification gap: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: topical relevance 5.2/100
- Verification gap: #21 EMVLight: A multi-agent reinforcement learning framework for an emergency vehicle decentralized routing and traffic signal control system: reproducibility 30.0/100

#### Missing Components

- methodology quality: Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation.

#### Source Evidence

- No bounded methodology or reproducibility source spans were found for this paper.

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models

- Paper ID: `W4386501849`
- ReadFirstScore: 38.9/100
- Year: 2023
- Field role: frontier, bridge in Topic Modeling. ReadFirst 38.9/100; frontier signal from year 2023 and velocity 70.2; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 16.5 | 0.300 | 5.0 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 73.4 | 0.200 | 14.7 | medium | OpenAlex did not provide a normalized percentile, so this falls back to candidate-local log citation count. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 70.2 | 0.100 | 7.0 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 28.0 | 0.100 | 2.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: citation impact 73.4/100 (medium confidence)
- Supporting signal: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: citation velocity 70.2/100 (medium confidence)
- Supporting signal: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: graph prestige 32.0/100 (medium confidence)
- Verification gap: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: topical relevance 16.5/100
- Verification gap: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: methodology quality 28.0/100
- Verification gap: #22 Siren's Song in the AI Ocean: A Survey on Hallucination in Large Language Models: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `evaluation` in abstract_inverted_index — "by LLMs. We present taxonomies of the LLM hallucination phenomena and evaluation benchmarks, analyze existing approaches aiming at mitigating LLM hall"
- methodology: marker `benchmark` in abstract_inverted_index — "present taxonomies of the LLM hallucination phenomena and evaluation benchmarks, analyze existing approaches aiming at mitigating LLM hallucination,"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #23 Argumentation mining: How can a machine acquire common sense and world knowledge?

- Paper ID: `W2739419429`
- ReadFirstScore: 37.9/100
- Year: 2017
- Field role: foundation, bridge in Topic Modeling. ReadFirst 37.9/100; foundation signal from impact 89.8, graph 32.0, local in-degree 0; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 19.7 | 0.300 | 5.9 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 89.8 | 0.200 | 18.0 | high | OpenAlex citation_normalized_percentile is normalized by work type, publication year, and subfield. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 26.7 | 0.100 | 2.7 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 20.0 | 0.100 | 2.0 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: citation impact 89.8/100 (high confidence)
- Supporting signal: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: graph prestige 32.0/100 (medium confidence)
- Supporting signal: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: reproducibility 30.0/100 (medium confidence)
- Verification gap: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: topical relevance 19.7/100
- Verification gap: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: methodology quality 20.0/100
- Verification gap: #23 Argumentation mining: How can a machine acquire common sense and world knowledge?: citation velocity 26.7/100

#### Source Evidence

- methodology: marker `statistical` in abstract_inverted_index — "uistics. This field investigates methods for representing language as statistical concepts or as vectors, allowing straightforward methods of compositi"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity

- Paper ID: `W4387596421`
- ReadFirstScore: 32.9/100
- Year: 2023
- Field role: bridge in Topic Modeling. ReadFirst 32.9/100; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 17.7 | 0.300 | 5.3 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 53.8 | 0.200 | 10.8 | medium | OpenAlex did not provide a normalized percentile, so this falls back to candidate-local log citation count. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 45.8 | 0.100 | 4.6 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 28.0 | 0.100 | 2.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: citation impact 53.8/100 (medium confidence)
- Supporting signal: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: citation velocity 45.8/100 (medium confidence)
- Supporting signal: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: graph prestige 32.0/100 (medium confidence)
- Verification gap: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: topical relevance 17.7/100
- Verification gap: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: methodology quality 28.0/100
- Verification gap: #24 Survey on Factuality in Large Language Models: Knowledge, Retrieval and Domain-Specificity: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `metric` in abstract_inverted_index — "tions to methodologies for evaluating LLM factuality, emphasizing key metrics, benchmarks, and studies. We further explore strategies for enhancing"
- methodology: marker `benchmark` in abstract_inverted_index — "methodologies for evaluating LLM factuality, emphasizing key metrics, benchmarks, and studies. We further explore strategies for enhancing LLM factual"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

### #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory

- Paper ID: `W4406840428`
- ReadFirstScore: 31.7/100
- Year: 2025
- Field role: bridge in Graph Theory and Algorithms. ReadFirst 31.7/100; bridge signal from 0 local citation edges or multiple field labels.

| Component | Available | Score | Applied Weight | Contribution | Confidence | Explanation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| topical relevance | yes | 35.4 | 0.300 | 10.6 | high | Topic match combines query-token overlap, title hits, and the source search rank. |
| citation impact | yes | 24.0 | 0.200 | 4.8 | medium | OpenAlex did not provide a normalized percentile, so this falls back to candidate-local log citation count. |
| graph prestige | yes | 32.0 | 0.200 | 6.4 | medium | PageRank-style prestige over the local seed plus citation-neighborhood graph; edges point from a citing paper to the paper it references. |
| citation velocity | yes | 21.3 | 0.100 | 2.1 | medium | Citation velocity estimates citations per publication-year to reduce old-paper bias. |
| methodology quality | yes | 48.0 | 0.100 | 4.8 | medium | Deterministic screening for methodology markers in metadata, abstracts, and enriched full text when available; this is not claim validation. |
| reproducibility | yes | 30.0 | 0.100 | 3.0 | medium | Screens for open-access/full-text/code/data signals; absence means not found in metadata, not proof that artifacts do not exist. |

#### Why This Rank

- Supporting signal: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: methodology quality 48.0/100 (medium confidence)
- Supporting signal: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: topical relevance 35.4/100 (high confidence)
- Supporting signal: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: graph prestige 32.0/100 (medium confidence)
- Verification gap: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: citation velocity 21.3/100
- Verification gap: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: citation impact 24.0/100
- Verification gap: #25 Zep: A Temporal Knowledge Graph Architecture for Agent Memory: reproducibility 30.0/100

#### Source Evidence

- methodology: marker `benchmark` in abstract_inverted_index — "t state-of-the-art system, MemGPT, in the Deep Memory Retrieval (DMR) benchmark. Additionally, Zep excels in more comprehensive and challenging evalu"
- methodology: marker `evaluation` in abstract_inverted_index — "hmark. Additionally, Zep excels in more comprehensive and challenging evaluations than DMR that better reflect real-world enterprise use cases. While e"
- methodology: marker `benchmark` in abstract_inverted_index — "business data while maintaining historical relationships. In the DMR benchmark, which the MemGPT team established as their primary evaluation metric"

#### Rubric Checks To Verify

- Limitations: not_evaluated. Limitations was not evaluated because no matching full-text section was extracted.
- Reproducibility Path: not_evaluated. Reproducibility Path was not evaluated because no matching full-text section was extracted.
- Experimental Details: not_evaluated. Experimental Details was not evaluated because no matching full-text section was extracted.
- Statistical Significance: not_evaluated. Statistical Significance was not evaluated because no matching full-text section was extracted.
- Compute Resources: not_evaluated. Compute Resources was not evaluated because no matching full-text section was extracted.

## Limits

- This audit explains the ranking math and visible evidence. It is not completed reproduction or claim validation.
- Missing evidence means PaperRank did not see it in OpenAlex metadata, URLs, abstracts, or requested full text; it is not proof the paper lacks it.
- Methodology and reproducibility screens route attention to checks a researcher should perform manually or with a future deeper review pass.
- Raw full text is intentionally not written here; only bounded source-span excerpts are included.
