# System Activity Specification

## Purpose

Recent system events feed — pipeline runs, errors, deployments, and system events — ordered by recency.

## Requirements

| # | Endpoint | Method | Query Params | Description |
|---|----------|--------|--------------|-------------|
| 1 | /v1/system/activity | GET | `limit` (default 20), `offset` (default 0) | Paginated activity feed |

### Requirement 1: Activity feed

The system MUST return a paginated list of system events ordered by `timestamp` descending.

#### Scenario: Happy path — activity with events

- GIVEN pipeline runs and errors exist in Engram
- WHEN GET /v1/system/activity?limit=10&offset=0
- THEN status MUST be `"success"`
- AND `result` MUST be a list of events each with `type`, `title`, `description`, `timestamp`
- AND the list MUST be ordered by `timestamp` descending
- AND `result` MUST have at most 10 items

#### Scenario: Activity includes optional fields

- GIVEN a pipeline run event with a CUIT and severity
- WHEN GET /v1/system/activity
- THEN each event MAY include `cuit` and `severity` fields

#### Scenario: Event type classification

- GIVEN events of different types exist
- WHEN GET /v1/system/activity
- THEN each event MUST have a `type` in: `pipeline_run`, `error`, `deployment`, `system`

#### Scenario: Empty activity

- GIVEN no events exist in the system
- WHEN GET /v1/system/activity
- THEN status MUST be `"success"`
- AND `result` MUST be an empty list

#### Scenario: Pagination — second page

- GIVEN 25 events exist
- WHEN GET /v1/system/activity?limit=20&offset=0
- THEN 20 events MUST be returned
- WHEN GET /v1/system/activity?limit=20&offset=20
- THEN 5 events MUST be returned
