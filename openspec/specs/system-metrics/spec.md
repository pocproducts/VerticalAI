# System Metrics Specification

## Purpose

Aggregated pipeline run metrics with configurable time periods for dashboard consumption.

## Requirements

| # | Endpoint | Method | Query Params | Description |
|---|----------|--------|--------------|-------------|
| 1 | /v1/system/metrics | GET | `period`: 24h | 7d | 30d | Aggregated pipeline metrics |

### Requirement 1: Aggregated metrics

The system MUST return pipeline metrics aggregated from Engram observations for the requested period.

#### Scenario: Happy path — metrics for 24h

- GIVEN Engram has pipeline run observations in the last 24 hours
- WHEN GET /v1/system/metrics?period=24h
- THEN status MUST be `"success"`
- AND `result` MUST contain `total_pipeline_runs`, `successful_runs`, `failed_runs`, `error_rate`, `total_cuits_processed`
- AND `runs_by_hour` MUST be a 24-element list of `{hour, count}`

#### Scenario: Metrics for 7d period

- WHEN GET /v1/system/metrics?period=7d
- THEN `runs_by_hour` MUST be absent (only for 24h)
- BUT all other aggregated fields MUST be present

#### Scenario: No pipeline runs in period

- GIVEN no pipeline runs exist in the requested period
- WHEN GET /v1/system/metrics?period=24h
- THEN `total_pipeline_runs` MUST be `0`
- AND `runs_by_hour` MUST be 24 entries all with `count: 0`

#### Scenario: Invalid period parameter

- GIVEN a period value not in `[24h, 7d, 30d]`
- WHEN GET /v1/system/metrics?period=90d
- THEN HTTP 422 MUST be returned with `VALIDATION_ERROR`

### Requirement 2: Recent errors list

The system MUST include `recent_errors` — the last N error messages from pipeline runs.

#### Scenario: Includes recent errors

- GIVEN pipeline runs with errors exist
- WHEN GET /v1/system/metrics?period=24h
- THEN `result.recent_errors` MUST be a non-empty list of error items with `message` and `timestamp`

#### Scenario: No recent errors

- GIVEN no pipeline errors in the period
- WHEN GET /v1/system/metrics
- THEN `recent_errors` MUST be an empty list
