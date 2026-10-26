---
name: ai-ml-pipeline
description: >-
  End-to-end AI/ML pipeline orchestration from data collection and preparation through annotation, training, evaluation, and inference deployment. Use when building or reviewing ML pipelines, model training or serving infrastructure, or MLOps workflows.
---

﻿# AI/ML Pipeline Skill

## Overview
End-to-end AI/ML pipeline orchestration from data collection through model deployment.

## Pipeline Stages

### 1. Data Collection
- **web-scraper**: Web data extraction, crawl design
- **api-collector**: REST/GraphQL API integration
- **data-harvester**: Multi-source data lake population
- **telemetry-engineer**: Product telemetry and event tracking

### 2. Data Preparation
- **corpus-builder**: Text corpus construction
- **data-cleaner**: Deduplication, missing values, outliers
- **data-preprocessor**: Feature scaling, encoding, splitting
- **data-validator**: Schema validation, drift detection
- **feature-engineer**: Feature store, selection, monitoring
- **data-quality-engineer**: Quality frameworks, observability

### 3. Dataset Management
- **dataset-curator**: Documentation, composition, representativeness
- **dataset-versioner**: DVC/Git LFS, lineage, reproducibility
- **data-annotator**: Labeling workflows, quality control
- **synthetic-data-generator**: Augmentation, GAN-based generation
- **dataset-auditor**: Bias detection, legal compliance

### 4. Model Development
- **model-trainer**: Training pipeline, hyperparameters, distributed training
- **fine-tuning-engineer**: LoRA/QLoRA, RLHF, DPO, alignment
- **prompt-engineer**: System prompts, few-shot, optimization
- **embedding-engineer**: Embedding models, semantic search
- **vector-db-engineer**: Vector indexing, hybrid search

### 5. Model Evaluation
- **model-evaluator**: Benchmarks, robustness, fairness testing
- **ml-ops-engineer**: Pipeline automation, experiment tracking
- **model-monitor**: Drift detection, health dashboards

### 6. Model Governance
- **ai-ethics-reviewer**: Ethics, transparency, accountability
- **bias-auditor**: Fairness metrics, mitigation strategies
- **explainability-engineer**: SHAP/LIME, audit trails
- **ai-safety-engineer**: Red teaming, guardrails

## When to Use
- Building or improving ML models
- Designing data pipelines for AI
- Evaluating model performance
- Addressing bias or safety concerns
- Deploying models to production

## Agent Selection
Use **agent-selector** to pick the right agents for your pipeline stage.
Use **workflow-orchestrator** to coordinate multi-agent pipelines.
