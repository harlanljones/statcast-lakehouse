# TECHNICAL DESIGN DOCUMENT (TDD)

**Project:** Statcast Lakehouse & Real-Time 3D Sabermetric Inference Engine

**Status:** Ready for Implementation

**Target SLA:** Sub-16ms UI input-to-paint (120 FPS), Sub-50ms analytical inference, <$5.00/mo operating cost

---

## 1. Executive Summary & Objective

Build an end-to-end data lakehouse and visualization platform that ingests Major League Baseball (MLB) Statcast telemetry, performs in-warehouse spatial transforms and machine learning inference in Google BigQuery, and serves interactive 3D pitch trajectories to a zero-latency client application.

### Key Success Metrics

* **UI Latency:** <16ms input-to-paint for trajectory filtering (60–120 FPS locked).
* **Serving Overhead:** Zero server-side re-computation during user interactions; all trajectory scrubbing executes on client WebGPU/WebGL buffers.
* **Warehouse Cost:** Operating within GCP Free Tier limits ($0.00 – $2.00/month).
* **Inference Speed:** In-warehouse batch inference under 2 seconds per game day; single-pitch lookup under 50ms.

---

## 2. System Architecture

```
                 [ MLB Live Stats API (Statcast Feed) ]
                                   |
                                   v
          [ Ingestion Service: Cloud Run Worker (Python/Polars) ]
                                   |
                                   | BigQuery batch load jobs (WRITE_APPEND, 5,000-row chunks)
                                   v
+----------------------------------------------------------------------+
| Google BigQuery                                                      |
|  |-- bronze_pitches (Raw JSON Staging, partitioned by ingestion_time)|
|  |-- fct_pitches    (Curated Fact: partitioned by game_date,         |
|  |                   clustered by pitcher_id, batter_id, pitch_type) |
|  |-- BigQuery GIS   (ST_GEOGPOINT, Plate 3D bounding box)            |
|  +-- BQML Engine    (BOOSTED_TREE_CLASSIFIER - xWhiff Model)         |
+----------------------------------------------------------------------+
                                   |
                                   | Batch Arrow Export / FastAPI Flight Stream
                                   v
+----------------------------------------------------------------------+
| Client Architecture (Browser)                                        |
|  |-- State Layer: SolidJS (Fine-Grained Reactive Signals)            |
|  |-- Compute Layer: Apache Arrow IPC (Zero-Copy Typed Arrays)        |
|  +-- Visual Engine: Deck.gl (TripsLayer + OrbitView in Cartesian)    |
+----------------------------------------------------------------------+
```

---

## 3. Data Ingestion & Warehouse Layer (GCP / BigQuery)

### 3.1 BigQuery Schema & Physical Storage Design

Tables must enforce partition filters to stay strictly within GCP Free Tier query scan allocations (1 TB/month).

```sql
-- Silver Curated Fact Table
CREATE TABLE `statcast_analytics.fct_pitches` (
  pitch_id STRING NOT NULL,
  game_id INT64 NOT NULL,
  game_date DATE NOT NULL,
  pitcher_id INT64 NOT NULL,
  batter_id INT64 NOT NULL,
  pitch_type STRING,
  -- Kinematic Parameters (Statcast 9-Parameter Trajectory Polynomials)
  release_speed FLOAT64,
  release_spin_rate FLOAT64,
  x0 FLOAT64, y0 FLOAT64, z0 FLOAT64,
  vx0 FLOAT64, vy0 FLOAT64, vz0 FLOAT64,
  ax FLOAT64, ay FLOAT64, az FLOAT64,
  -- Plate Intersect Coordinates
  plate_x FLOAT64,
  plate_z FLOAT64,
  sz_top FLOAT64,
  sz_bot FLOAT64,
  -- Classification Targets
  is_swing INT64,
  is_whiff INT64,
  -- Spatial Objects
  plate_location GEOGRAPHY
)
PARTITION BY game_date
CLUSTER BY pitcher_id, batter_id, pitch_type
OPTIONS (
  require_partition_filter = TRUE,
  partition_expiration_days = 1095,
  description = "Curated Statcast pitch event store with spatial strike zone mapping"
);
```

Retention is three years (1095 days) on both `fct_pitches` and `bronze_pitches`, so backfilled seasons are not expired on arrival: bronze is partitioned by `ingestion_time`, which the live path sets to the game day. Three seasons is about 3.6 GB against the 10 GB free tier.

### 3.2 Ingestion Worker (`ingestion/worker.py`)

* **Runtime:** Cloud Run Job (Python 3.11, containerized).
* **Protocol:** BigQuery batch load jobs (`load_table_from_json`, `WRITE_APPEND`) on the free shared slot pool.
* **Requirements:**
1. Do not use legacy streaming API (`tabledata.insertAll`) to eliminate ingestion costs.
2. Batch writes in 5,000-row chunks, one load job per chunk. Rows are normalized to JSON-safe values first (`date`/`datetime` become ISO strings), because `load_table_from_json` serializes with a bare `json.dumps`.
3. Stay inside the 1,500 load jobs per table per day quota (about one job per game day).

### 3.3 Spatial Transformations (BigQuery GIS)

Executed on the per-day curation MERGE (`warehouse/ddl/03_curate_day.sql`):

```sql
ST_GEOGPOINT(plate_x, plate_z)
```

### 3.4 In-Warehouse Machine Learning (BQML xWhiff)

Train a gradient-boosted decision tree directly on pitch kinematics to estimate expected whiff probability on swings. See `warehouse/bqml/train_whiff_model.sql` (BOOSTED_TREE_CLASSIFIER, swings only, 1-year window).

---

## 4. Serving & Serialization Layer

* **Delivery Format:** Apache Arrow IPC Stream (`.arrow` / `.feather`).
* **Serving Strategy:**
1. **Historical / Cold Batches:** Cloud Run extracts date/pitcher partitions into compressed Arrow batches in Cloud Storage (GCS) with public CDN cache headers.
2. **Live Feed / Warm:** FastAPI endpoint (`serving/app.py`) on Cloud Run streaming Arrow record batches directly over HTTP to bypass JSON serialization overhead.

---

## 5. Client Visualization Architecture

### 5.1 Technology Selection

* **UI Framework:** SolidJS (fine-grained reactivity, no Virtual DOM diffing).
* **Rendering Engine:** Deck.gl (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/extensions`).
* **Data Layer:** `apache-arrow` JS SDK.
* **Coordinate System:** `COORDINATE_SYSTEM.CARTESIAN` using `OrbitView` (Z-axis up).

### 5.2 Kinematic Trajectory Solver (`web/src/lib/kinematics.ts`)

The client recalculates 60 positional coordinates per pitch from raw Statcast kinematic constants:

```
x(t) = x0 + vx0*t + (1/2) ax*t^2
y(t) = y0 + vy0*t + (1/2) ay*t^2
z(t) = z0 + vz0*t + (1/2) az*t^2
```

Solve for total flight duration t_end when the ball reaches the front face of home plate (y = 1.417 ft):

```
t_end = (-vy0 - sqrt(vy0^2 - 2*ay*(y0 - 1.417))) / ay
```

(Implementation note: the code picks the earliest root at which the ball is still approaching the plate — see the mirrored tests in `web/src/lib/kinematics.test.ts` and `ingestion/tests/test_worker.py`.)

### 5.3 Zero-Latency GPU Filtering Pattern

Do **not** filter pitch arrays in JavaScript when sliders move. Bind slider controls directly to Deck.gl uniform buffers via `DataFilterExtension` (`web/src/lib/deck-layers.ts`):

```typescript
new TripsLayer({
  id: 'pitch-trajectories',
  getFilterValue: d => [d.releaseSpeed, d.pfxX, d.pfxZ],
  filterRange: [[minSpeed(), maxSpeed()], [minHBreak(), maxHBreak()], [minVBreak(), maxVBreak()]],
  extensions: [new DataFilterExtension({ filterSize: 3 })]
});
```

---

## 6. Directory Structure

```
statcast-lakehouse/
├── infra/main.tf          # BigQuery dataset, budget guard, Cloud Run job, scheduler
├── ingestion/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── worker.py          # solver + BigQuery load-job writer
│   ├── mlb_client.py      # Statcast API polling logic
│   └── tests/
├── serving/app.py         # FastAPI Arrow IPC endpoints
├── warehouse/
│   ├── ddl/               # 01 bronze, 02 curated, 03 per-day MERGE
│   └── bqml/              # train_whiff_model.sql, predict_live_game.sql
└── web/
    ├── package.json, vite.config.ts, tsconfig.json, index.html
    └── src/
        ├── App.tsx
        ├── lib/           # arrow-loader.ts, kinematics.ts, deck-layers.ts
        └── components/    # Visualizer.tsx, ControlPanel.tsx
```

---

## 7. Cost Ceiling & Quota Protections

| Service | Free Tier Allocation | Estimated Project Usage | Margin / Safety |
| --- | --- | --- | --- |
| BigQuery Storage | 10 GB / month | ~3.6 GB (3 seasons compressed) | 64% Headroom |
| BigQuery Queries | 1 TB / month | ~30 GB / month (partitioned) | 97% Headroom |
| BigQuery load jobs | Free (shared slots); 1,500 jobs / table / day | ~1-2 jobs / day | >99% Headroom |
| Cloud Run Ingestion | 180,000 vCPU-sec | ~25,000 vCPU-sec | 86% Headroom |
| GCS Artifacts | 5 GB Standard | ~500 MB (Arrow files) | 90% Headroom |

**Enforcement:** Strict GCP budget alert at **$4.00/month** (`google_billing_budget.hard_ceiling` in `infra/main.tf`); wire the disable-billing Cloud Function before first apply.

---

## 8. Implementation Plan & Sprints

Tracked with acceptance criteria in `docs/ROADMAP.md` (Sprints 1–4 of the original plan).
