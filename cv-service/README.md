# Smart Mall Parking - Computer Vision Service

This service provides automated vehicle detection and parking occupancy monitoring using **Ultralytics YOLOv8**, **OpenCV**, and **NumPy**.

## Project Structure

```text
cv-service/
├── config/
│   ├── __init__.py
│   ├── settings.py         # Detection thresholds, class mappings (COCO 2, 3), colors
│   ├── topology.py         # Canonical shared topology (floors, 24 slots, gates, ramps, junctions)
│   ├── topology.json       # Cross-platform JSON export of topology
│   └── slots_config.json   # Multi-camera normalized polygon coordinates for all 24 slots
├── detection/
│   ├── __init__.py
│   ├── detector.py         # YOLOv8 vehicle detection engine with COCO filtering
│   ├── slot_mapper.py      # Vehicle-to-slot ROI mapping and occupancy candidate engine
│   └── video_processor.py  # Video stream processor and frame extractor
├── models/
│   └── __init__.py         # YOLO model directory (weights ignored from git)
├── tools/
│   ├── __init__.py
│   └── calibrate_roi.py    # Interactive OpenCV ROI calibration utility (GUI & programmatic)
├── utils/
│   ├── __init__.py
│   ├── roi_utils.py        # ROI loading, saving, validation & coordinate conversion
│   ├── visualizer.py       # High-visibility bounding box, ROI polygon, mapping lines & HUD
│   └── synthetic_media.py  # Synthetic parking test image & video generator
├── tests/
│   ├── test_detector.py    # Detection unit & integration test suite
│   ├── test_roi.py         # ROI schema, coordinate conversion & validation test suite
│   ├── test_slot_mapper.py # Vehicle-to-slot mapping & conflict disambiguation test suite
│   └── test_pipeline.py    # Unified CVPipeline integration test suite (12 tests)
├── topology.py             # Root re-export of topology
├── pipeline.py             # Phase 4: Unified CVPipeline class
├── main.py                 # CLI entry point (--source, --image, --video, --demo, --calibrate)
├── requirements.txt        # Python dependencies
└── README.md
```

## Technologies & Target Classes

- **Python 3.10+** (tested on Python 3.12)
- **Ultralytics YOLOv8**: Real-time object detection
  - **COCO Class 2:** `car` (Four-Wheeler)
  - **COCO Class 3:** `motorcycle` (Two-Wheeler)
- **OpenCV (`opencv-python`)**: Video stream reading, frame decoding, and HUD overlays
- **NumPy**: Bounding box geometry and vectorized tensor operations

---

## Installation & Setup

### 1. Create and Activate Virtual Environment

```bash
# Windows (PowerShell)
cd cv-service
python -m venv venv
.\venv\Scripts\Activate.ps1

# macOS / Linux
cd cv-service
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## How to Run the Detection Module

### 1. Run Automated Demonstration (Synthetic Test Media)
Generates sample parking lot media with vehicles and demonstrates detection:
```bash
python main.py --demo
```

### 2. Detect Vehicles in an Image
```bash
python main.py --image path/to/parking_photo.jpg --conf 0.45
```
* Generates annotated visual output: `output/detected_parking_photo.jpg`
* Generates structured JSON output: `output/detections_parking_photo.json`

### 3. Detect Vehicles in a Video Stream
```bash
python main.py --video path/to/parking_cctv.mp4 --conf 0.50
```

### 4. Verify Shared Parking Topology
```bash
python main.py --verify-topology
```

### 5. Run Test Suite
```bash
python tests/test_detector.py
```

---

## Structured Output Format

For each detected vehicle, the detector returns structured, serializable data:

```json
{
  "frame_timestamp": 0.0,
  "total_vehicles": 2,
  "car_count": 1,
  "motorcycle_count": 1,
  "inference_time_ms": 14.8,
  "detections": [
    {
      "class_name": "car",
      "class_id": 2,
      "confidence": 0.9124,
      "bounding_box": [120, 140, 360, 480],
      "frame_timestamp": 0.0
    },
    {
      "class_name": "motorcycle",
      "class_id": 3,
      "confidence": 0.8672,
      "bounding_box": [580, 220, 690, 410],
      "frame_timestamp": 0.0
    }
  ]
}
```

---

## Phase 2: Parking Slot ROI Configuration & Calibration

Phase 2 introduces polygon-based Region of Interest (ROI) mapping for all 24 parking bays across camera streams (`CAM-B1-01` and `CAM-B2-01`), associating physical slots with image regions without hardcoded camera resolutions.

### 1. Normalized Coordinates Architecture
* ROIs are represented as 4-point polygon vertices in **normalized coordinates** \([0.0, 1.0]\) relative to camera frame dimensions:
  \[
  x_{\text{norm}} = \frac{x_{\text{pixel}}}{W}, \quad y_{\text{norm}} = \frac{y_{\text{pixel}}}{H}
  \]
* **Benefits**:
  - Resolution agnostic: Works seamlessly across 720p, 1080p, 2K, or 4K RTSP streams.
  - Scale invariance: Image resizing or stream re-encoding preserves slot boundaries.
  - Portable across OpenCV, PyTorch, and web SVG/canvas renderers.

### 2. Multi-Camera Configuration Schema (`config/slots_config.json`)
The configuration defines camera-specific slot mappings adhering strictly to `topology.py`:
- `CAM-B1-01` covers Floor B1 (`B1-A01` .. `B1-A12`)
- `CAM-B2-01` covers Floor B2 (`B2-A01` .. `B2-A12`)
- Slot IDs are validated against `topology.ALL_SLOT_IDS` to prevent duplicates across cameras or out-of-bounds coordinates.

### 3. Interactive OpenCV Calibration Utility (`tools/calibrate_roi.py`)
Calibrate parking slots interactively on live camera frames or static snapshots.

#### Controls & Shortcuts:
* **Left Click**: Place polygon vertex (requires 4 points per slot).
* **`C` / Space**: Confirm 4-point polygon and advance to the next slot.
* **`U`**: Undo the last placed point.
* **`S`**: Save configuration to `config/slots_config.json`.
* **`N`**: Skip to the next slot without modifying the current slot.
* **`P`**: Return to the previous slot.
* **`Q` / Esc**: Quit calibration utility.

#### Interactive Calibration Examples:
```bash
# Launch interactive calibration on a camera image
python tools/calibrate_roi.py --image path/to/floor_b1_cctv.jpg --camera CAM-B1-01

# Launch calibration directly via main entrypoint
python main.py --calibrate --image path/to/floor_b1_cctv.jpg --camera CAM-B1-01

# Programmatic slot coordinate update (headless / automation)
python tools/calibrate_roi.py --set-slot B1-A01 --camera CAM-B1-01 --coords "[[0.06,0.14],[0.18,0.14],[0.18,0.48],[0.06,0.48]]"
```

### 4. Detecting Vehicles with ROI Overlay
Visualize YOLOv8 bounding boxes alongside parking slot ROI polygons:
```bash
# Detect vehicles and overlay slot ROIs
python main.py --image path/to/b1_snapshot.jpg --rois --camera-id CAM-B1-01

# Run demo with synthetic test media and ROI overlay
python main.py --demo --rois
```

### 5. Running Phase 2 Tests
```bash
python tests/test_roi.py
```

---

## Phase 3: Vehicle-to-Slot Mapping Using ROI Overlap

Phase 3 introduces automated geometric matching connecting detected vehicles with parking slot ROIs to derive real-time camera occupancy candidates.

### 1. Dual-Metric Matching Pipeline
YOLOv8 bounding boxes often extend beyond parking lines due to 3D perspective distortion (e.g. vehicle hoods, roofs, and mirrors). To solve this, Phase 3 implements an exact dual-metric strategy:
1. **Bottom-Center Point Containment (Primary Metric)**:
   \[
   x_{\text{center}} = \frac{x_1 + x_2}{2}, \quad y_{\text{bottom}} = y_2
   \]
   Evaluates whether the vehicle's ground-contact wheel patch lies within the parking bay polygon using ray-casting.
2. **Exact Polygon Intersection & IoU (Secondary Metric)**:
   Instead of axis-aligned bounding box approximations, the exact intersection polygon between the vehicle bounding box and the parking slot polygon is computed via the **Sutherland-Hodgman clipping algorithm** and sized with the **Shoelace formula**. This avoids counting empty areas outside tilted or angled parking bays.
3. **Harmonized Scoring Function**:
   - If bottom-center is inside polygon (`contained == True`):
     \[
     \text{Score} = \text{point\_containment\_bonus} + \text{overlap\_weight} \times \max(\text{IoU}, \text{overlap\_ratio})
     \]
     With defaults (`0.50 + 0.50 * max`), the score is \(\ge 0.50\), guaranteeing qualification (\(\ge \text{min\_match\_score} = 0.15\)).
   - If bottom-center is outside polygon (`contained == False`):
     Candidate must satisfy \(\text{overlap\_ratio} \ge \text{min\_overlap\_ratio} \ (0.30)\) OR \(\text{IoU} \ge \text{min\_iou} \ (0.20)\).
     \[
     \text{Score} = \text{overlap\_weight} \times \max(\text{IoU}, \text{overlap\_ratio}) = 0.50 \times \max(\text{IoU}, \text{overlap\_ratio})
     \]
     At the minimum required overlap of \(0.30\), the score is \(0.50 \times 0.30 = 0.15 \ge \text{min\_match\_score}\). The initial overlap gate and final score threshold are 100% mathematically aligned.

### 2. Disambiguation, Conflict Detection & Candidate States
- **1-to-1 Association**: Vehicles are sorted by score descending and assigned to their highest-ranking slot.
- **Physical Overlap vs. Capacity Conflict (`conflict_iou_threshold = 0.20`)**:
  When multiple vehicles claim the same bay, pairwise inter-vehicle bounding box IoU is computed:
  - If \(\text{inter-vehicle IoU} \ge 0.20\): Classified as a **Physical Overlap Conflict** (e.g. duplicate detections, ghost bounding boxes, or severe occlusion).
  - If \(\text{inter-vehicle IoU} < 0.20\): Classified as a **Capacity Conflict** (multiple distinct vehicles trying to occupy one bay simultaneously).
- **Boundary Ambiguity (`boundary_ambiguity_threshold = 0.06`)**: If the score difference between the top-two candidate bays is \(< 0.06\), the vehicle is flagged with boundary ambiguity.
- **Occupancy Candidates**:
  - `occupied`: Clean single vehicle assignment without ambiguity.
  - `available_candidate`: Monitored bay with zero vehicle claims in current frame.
  - `uncertain`: Flagged on multi-vehicle conflict or boundary straddling.
  - `unmapped`: Detections in driving thoroughfares or outside all calibrated bays.

### 3. Execution & Visualization Commands
```bash
# Run automated synthetic detection and slot mapping demo
python main.py --demo

# Run detection and slot mapping on an actual image
python main.py --image path/to/cctv_frame.jpg --map-slots --camera-id CAM-B1-01

# Run full test suite across detection, ROIs, and slot mapping (31 tests)
python -m unittest discover -s tests -p "test_*.py"
```

---

## Phase 4: Unified CV Pipeline

Phase 4 integrates all prior phases (detection → ROI → slot mapping) into a single
reusable `CVPipeline` class and exposes it through the `--source` CLI flag.

### Pipeline Architecture

```
Input Source (image / video / webcam)
        │
        ▼
  OpenCV Frame Capture
        │
        ▼
  YOLOv8 Vehicle Detection  ←── allow_mock=True if Ultralytics unavailable
        │
        ▼
  Camera ROI Configuration  ←── slots_config.json  (normalized polygons)
        │
        ▼
  Vehicle-to-Slot Mapping   ←── Bottom-center + exact polygon clipping (Sutherland-Hodgman)
        │
        ▼
  Conflict & Ambiguity Detection
        │
        ├──→  Structured JSON Record (frame_record or summary)
        └──→  Annotated BGR Frame (visualization + HUD)
```

### CVPipeline Constructor Parameters

| Parameter           | Type            | Default                   | Description                                    |
|---------------------|-----------------|---------------------------|------------------------------------------------|
| `model_path`        | `str`           | `models/yolov8n.pt`       | Path to YOLOv8 weights file                   |
| `conf_threshold`    | `float`         | `0.45`                    | Detection confidence threshold                 |
| `config_path`       | `str`           | `config/slots_config.json`| Path to camera ROI configuration               |
| `camera_id`         | `str`           | `"CAM-B1-01"`             | Target camera identifier                       |
| `output_dir`        | `str`           | `"outputs"`               | Root directory for all pipeline outputs        |
| `slot_mapper_config`| `SlotMapperConfig` | default thresholds     | Custom matching threshold overrides            |
| `allow_mock`        | `bool`          | `True`                    | Fallback to mock/simulation if YOLO unavailable|
| `detector`          | `VehicleDetector` | `None`                  | Pre-configured detector instance (for testing) |
| `slot_mapper`       | `SlotMapper`    | `None`                    | Pre-configured mapper instance (for testing)   |

### CLI Usage (`--source` flag)

```bash
# Process a parking lot image (auto-detects by extension)
python main.py --source path/to/cctv_frame.jpg --camera-id CAM-B1-01

# Process a video file
python main.py --source path/to/parking_feed.mp4 --camera-id CAM-B2-01

# Process a live webcam feed (device index 0)
python main.py --source 0 --camera-id CAM-B1-01

# Process an RTSP stream
python main.py --source rtsp://192.168.1.100:554/stream1 --camera-id CAM-B1-01

# Custom confidence threshold and output directory
python main.py --source frame.jpg --camera-id CAM-B1-01 --conf 0.55 --output-dir results
```

### Output Directory Structure

```
outputs/
├── images/
│   └── annotated_<basename>.jpg     # Annotated image with ROI overlays & HUD
├── videos/
│   └── annotated_<basename>.mp4     # Annotated video (per-frame mapping)
└── json/
    ├── occupancy_<basename>.json    # Per-image frame record
    └── occupancy_video_<basename>.json  # Per-video summary + latest candidates
```

### JSON Frame Record Schema

```json
{
  "frame_number": 1,
  "timestamp": 0.0,
  "camera_id": "CAM-B1-01",
  "floor": "B1",
  "inference_time_ms": 0.0,
  "summary": {
    "total_slots_monitored": 12,
    "occupied_count": 3,
    "available_candidate_count": 8,
    "uncertain_count": 1,
    "unmapped_vehicles_count": 0
  },
  "detections": [...],
  "mapped_vehicles": [...],
  "unmapped_vehicles": [...],
  "slot_occupancy_candidates": {
    "B1-A01": { "slot_id": "B1-A01", "candidate_status": "occupied", ... },
    ...
  },
  "mapping_conflicts": [...]
}
```

> **Note**: `available_candidate` does **not** guarantee the slot is physically empty.
> It only means no vehicle was detected in this camera frame. Occlusion, lighting,
> or camera angle limitations can cause false negatives. Temporal tracking
> (Milestone 5) is required for authoritative occupancy state.

### Integration Tests (Phase 4)

12 integration tests in `tests/test_pipeline.py` covering:

| Test | Description |
|------|-------------|
| `test_01` | Complete pipeline on a saved JPEG image file |
| `test_02` | Complete pipeline on a synthetic MP4 video |
| `test_03` | Empty detections → all slots `available_candidate` |
| `test_04` | Vehicle inside B1-A01 ROI → `occupied` candidate + mapped entry |
| `test_05` | Vehicle outside all ROIs → `unmapped` classification |
| `test_06` | Boundary-straddling vehicle → `uncertain` / conflict / unmapped |
| `test_07` | Two vehicles in same slot → `uncertain` + conflict details |
| `test_08` | CAM-B2-01 → only `B2-Axx` slot IDs in output |
| `test_09` | Missing image path → `FileNotFoundError`; invalid camera → `ValueError` |
| `test_10` | `json.dumps()` on frame record → no `TypeError` (no NumPy scalars) |
| `test_11` | Annotated frame is `ndarray` with same spatial dimensions |
| `test_12` | 5 consecutive frames with correct `frame_number` field |

Tests require OpenCV + NumPy; they are **auto-skipped** in environments without those packages.

```bash
# Run only Phase 4 pipeline tests
python -m unittest cv-service/tests/test_pipeline.py -v

# Run complete test suite (43 tests total)
python -m unittest discover -s tests -p "test_*.py"
```

### Known Limitations (Phase 4)

- **Synthetic testing only** – All integration tests use NumPy-generated frames and
  manually positioned bounding boxes. No real CCTV footage has been validated.
- **No temporal tracking** – Per-frame only. Each frame is independent; there is no
  multi-frame stabilisation or occupancy hysteresis.
- **No backend integration** – JSON output is written to local `outputs/json/`.
  MongoDB / Express API push is out of scope (Milestone 5).
- **Mock detector** – Without real YOLOv8 weights (`yolov8n.pt`), the pipeline falls
  back to `allow_mock=True` and produces zero detections unless `custom_detections`
  are injected.

---

## Model Weights & Git Safety

* Weights (`*.pt`, `*.onnx`) are automatically ignored via `.gitignore`.
* Pretrained weights (`yolov8n.pt`) can be placed in `models/` or are automatically resolved by Ultralytics upon initial inference.
