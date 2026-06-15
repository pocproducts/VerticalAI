# Pipeline Run Tracking Specification

## Purpose

First-class `PipelineRun` model persisted to Engram for every pipeline execution, enabling metrics, activity feed, and error analysis.

## Requirements

| # | Feature | Scope | Description |
|---|---------|-------|-------------|
| 1 | PipelineRun model | Pipeline | Record each run as structured Engram observation |
| 2 | Idempotency | Pipeline | Deduplicate by `run_id` |

### Requirement 1: PipelineRun persistence

The pipeline MUST persist a `PipelineRun` to Engram for every execution. The record MUST contain `run_id` (UUID v4), `cuit`, `status` (`success`|`partial`|`failed`), `stages_completed`, `error` (optional), `timestamp`, and `duration_seconds`.

#### Scenario: Successful pipeline run

- GIVEN a pipeline run completes all stages without errors
- WHEN the pipeline finishes
- THEN a `PipelineRun` MUST be saved with `status: "success"`
- AND `stages_completed` MUST list all executed stages
- AND `duration_seconds` MUST be the wall-clock runtime

#### Scenario: Partial success

- GIVEN a pipeline run where some stages succeed and some fail
- WHEN the pipeline finishes
- THEN a `PipelineRun` MUST be saved with `status: "partial"`
- AND `stages_completed` MUST only list the successfully completed stages
- AND `error` MUST describe the failure

#### Scenario: Pipeline failure

- GIVEN a pipeline run fails before completing any stage
- WHEN the pipeline errors
- THEN a `PipelineRun` MUST be saved with `status: "failed"`
- AND `stages_completed` MUST be empty
- AND `error` MUST contain the exception message

### Requirement 2: Observer pattern — no retry on save failure

The pipeline MUST NOT fail or retry if the `PipelineRun` save to Engram fails.

#### Scenario: Engram unavailable

- GIVEN Engram is unreachable when the pipeline finishes
- WHEN the pipeline tries to save the `PipelineRun`
- THEN the save MUST fail silently
- AND the pipeline result MUST NOT be affected

### Requirement 3: Idempotency

The system MUST use `run_id` (UUID v4) as an idempotency key to prevent duplicate records.

#### Scenario: Duplicate run_id ignored

- GIVEN a `PipelineRun` with `run_id=abc-123` already exists in Engram
- WHEN the pipeline attempts to persist a second run with the same `run_id`
- THEN the new save MUST be skipped
- AND no duplicate observations MUST be created
