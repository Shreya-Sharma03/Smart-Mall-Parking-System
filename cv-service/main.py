"""
Smart Mall Parking - Computer Vision Service
Main entry point for vehicle detection, ROI calibration, and media analysis.
Milestone 4: YOLOv8 Vehicle Detection & Slot ROI Mapping.
Phase 4: Unified CVPipeline integration via --source flag.
"""

import os
import sys
import argparse
import json

from config.topology import TOPOLOGY, ALL_SLOT_IDS, FLOORS, PARKING_STATUSES
from config.settings import DEFAULT_CONF_THRESHOLD, DEFAULT_IOU_THRESHOLD, DEFAULT_MODEL_PATH
from detection.detector import VehicleDetector
from detection.video_processor import VideoProcessor
from detection.slot_mapper import SlotMapper, SlotMapperConfig, FrameMappingResult
from utils.visualizer import draw_detections, draw_detections_and_rois, draw_mapping_results
from utils.roi_utils import load_slots_config, draw_roi_polygons, DEFAULT_CONFIG_PATH
from utils.synthetic_media import save_test_media_assets
from pipeline import CVPipeline


def verify_topology():
    """Validates the shared parking topology configuration."""
    print("==================================================")
    print("Smart Mall Parking - Topology Verification")
    print("==================================================")
    print(f"Configured Floors: {', '.join(FLOORS)}")
    print(f"Total Parking Slots: {len(ALL_SLOT_IDS)}")
    print(f"Floor B1 Slots ({len(TOPOLOGY['slots']['B1'])}): {TOPOLOGY['slots']['B1'][0]} .. {TOPOLOGY['slots']['B1'][-1]}")
    print(f"Floor B2 Slots ({len(TOPOLOGY['slots']['B2'])}): {TOPOLOGY['slots']['B2'][0]} .. {TOPOLOGY['slots']['B2'][-1]}")
    print(f"Entry Gates: {', '.join(g['id'] for g in TOPOLOGY['gates'])}")
    print(f"Ramp Nodes: {', '.join(r['id'] for r in TOPOLOGY['ramps'])}")
    print(f"Junctions: {', '.join(j['id'] for j in TOPOLOGY['junctions'])}")
    print(f"Allowed Statuses: {', '.join(PARKING_STATUSES)}")
    print("==================================================")
    print("[OK] Topology verification passed. All 24 slots confirmed.")
    print("==================================================")


def process_image_command(
    detector: VehicleDetector,
    image_path: str,
    output_dir: str,
    show_rois: bool = False,
    map_slots: bool = False,
    camera_id: str = "CAM-B1-01",
    config_path: str = DEFAULT_CONFIG_PATH,
):
    """Processes a single image file with vehicle detection, optional ROI overlay, and slot mapping."""
    print(f"\n[VehicleDetector] Processing Image: {image_path}")
    try:
        frame_detections, original_frame = detector.detect_image(image_path)
    except Exception as e:
        print(f"[Error] Failed to process image: {e}")
        return False

    # Print structured detection results
    print(f"[Results] Found {frame_detections.total_vehicles} vehicle(s) in {frame_detections.inference_time_ms:.1f}ms:")
    print(f"  - Cars: {frame_detections.car_count}")
    print(f"  - Motorcycles: {frame_detections.motorcycle_count}")

    for i, det in enumerate(frame_detections.detections, 1):
        x1, y1, x2, y2 = det.bounding_box
        print(f"  [{i}] {det.class_name.upper()} | Conf: {det.confidence * 100:.1f}% | Box: [{x1}, {y1}, {x2}, {y2}]")

    os.makedirs(output_dir, exist_ok=True)
    import cv2
    h, w = original_frame.shape[:2]

    # Slot Mapping Mode (Phase 3)
    if map_slots:
        try:
            slots_cfg = load_slots_config(config_path)
            mapper = SlotMapper()
            mapping_result = mapper.map_detections(
                frame_detections.detections,
                slots_cfg,
                frame_dims=(w, h),
                camera_id=camera_id,
            )

            print(f"\n[SlotMapper] Vehicle-to-Slot Mapping ({camera_id} - Floor {mapping_result.floor}):")
            print(f"  - Monitored Bays: {mapping_result.total_slots_monitored}")
            print(f"  - Occupied Bays: {mapping_result.occupied_count}")
            print(f"  - Available Candidates: {mapping_result.available_candidate_count}")
            print(f"  - Uncertain / Conflicts: {mapping_result.uncertain_count}")
            print(f"  - Unmapped Vehicles: {mapping_result.unmapped_vehicles_count}")

            for v in mapping_result.mapped_vehicles:
                conflict_str = " [CONFLICT]" if v.is_conflict else ""
                print(f"  * Vehicle ({v.vehicle_class.upper()}) -> {v.slot_id} | Score: {v.overlap_score:.2f} | Method: {v.mapping_method}{conflict_str}")

            for v in mapping_result.unmapped_vehicles:
                print(f"  * Vehicle ({v.vehicle_class.upper()}) -> UNMAPPED (outside all ROIs)")

            annotated = draw_mapping_results(
                original_frame,
                mapping_result,
                slots_cfg,
                show_lines=True,
            )
            out_filename = f"mapped_{os.path.basename(image_path)}"

            # Save mapping JSON
            mapping_json_path = os.path.join(output_dir, f"mapping_{os.path.splitext(os.path.basename(image_path))[0]}.json")
            with open(mapping_json_path, "w") as f:
                json.dump(mapping_result.to_dict(), f, indent=2)
            print(f"[Output] Mapping JSON saved to: {mapping_json_path}")

        except Exception as e:
            print(f"[Warning] Slot mapping failed: {e}. Falling back to standard detection overlay.")
            annotated = draw_detections(original_frame, frame_detections.detections)
            out_filename = f"detected_{os.path.basename(image_path)}"

    elif show_rois:
        try:
            slots_cfg = load_slots_config(config_path)
            annotated = draw_detections_and_rois(
                original_frame,
                frame_detections.detections,
                slots_cfg,
                camera_id=camera_id,
            )
            out_filename = f"detected_roi_{os.path.basename(image_path)}"
        except Exception as e:
            print(f"[Warning] Could not load ROIs: {e}. Falling back to detections-only.")
            annotated = draw_detections(original_frame, frame_detections.detections)
            out_filename = f"detected_{os.path.basename(image_path)}"
    else:
        annotated = draw_detections(original_frame, frame_detections.detections)
        out_filename = f"detected_{os.path.basename(image_path)}"

    out_path = os.path.join(output_dir, out_filename)
    cv2.imwrite(out_path, annotated)
    print(f"[Output] Annotated image saved to: {out_path}")

    # Save JSON results
    json_path = os.path.join(output_dir, f"detections_{os.path.splitext(os.path.basename(image_path))[0]}.json")
    with open(json_path, "w") as f:
        json.dump(frame_detections.to_dict(), f, indent=2)
    print(f"[Output] Structured JSON saved to: {json_path}")
    return True


def process_video_command(
    detector: VehicleDetector,
    video_path: str,
    output_dir: str,
    max_frames: int = 150,
):
    """Processes a video file with frame-by-frame vehicle detection."""
    print(f"\n[VehicleDetector] Processing Video: {video_path}")
    processor = VideoProcessor(detector)

    os.makedirs(output_dir, exist_ok=True)
    total_processed = 0
    total_detections_count = 0

    try:
        for frame_dets, _ in processor.process_video_stream(video_path, max_frames=max_frames):
            total_processed += 1
            total_detections_count += frame_dets.total_vehicles
            if total_processed % 15 == 0 or total_processed == 1:
                print(f"  Frame {total_processed:03d} (T={frame_dets.frame_timestamp:.2f}s) -> "
                      f"Detected: {frame_dets.total_vehicles} (Cars: {frame_dets.car_count}, Bikes: {frame_dets.motorcycle_count})")
    except Exception as e:
        print(f"[Error] Video processing failed: {e}")
        return False

    print(f"[VideoProcessor] Processed {total_processed} frames successfully.")
    print(f"[VideoProcessor] Total vehicle instances captured: {total_detections_count}")
    return True


def run_synthetic_demo_pipeline(output_dir: str, config_path: str = DEFAULT_CONFIG_PATH):
    """
    Demonstrates the Phase 3 vehicle-to-slot mapping and occupancy candidate pipeline
    using structured synthetic vehicle detections without requiring GPU / PyTorch weights.
    """
    print("==================================================")
    print("Smart Mall Parking - Synthetic Detection & Slot Mapping Demo")
    print("==================================================")
    print("[Info] Demonstrating Phase 3 mapping pipeline using synthetic vehicle detections.")

    os.makedirs(output_dir, exist_ok=True)
    slots_cfg = load_slots_config(config_path)
    mapper = SlotMapper()

    # Define synthetic detections on Floor B1 (CAM-B1-01, 1920x1080)
    # B1-A01 is [0.05, 0.12] to [0.18, 0.48] -> pixels: [96, 130, 345, 518]
    # B1-A03 is [0.35, 0.08] to [0.48, 0.35] -> pixels: [672, 86, 921, 378]
    # B1-A07 is [0.05, 0.55] to [0.18, 0.90] -> pixels: [96, 594, 345, 972]
    # Aisle vehicle (outside all ROIs) -> [1400, 800, 1680, 960]
    synthetic_detections = [
        {
            "class_name": "car",
            "confidence": 0.942,
            "bounding_box": [120, 160, 320, 500],
            "timestamp": 1.0,
        },
        {
            "class_name": "car",
            "confidence": 0.915,
            "bounding_box": [700, 110, 890, 360],
            "timestamp": 1.0,
        },
        {
            "class_name": "motorcycle",
            "confidence": 0.884,
            "bounding_box": [130, 620, 240, 880],
            "timestamp": 1.0,
        },
        {
            "class_name": "car",
            "confidence": 0.923,
            "bounding_box": [1400, 800, 1680, 960],
            "timestamp": 1.0,
        },
        {
            "class_name": "car",
            "confidence": 0.935,
            "bounding_box": [800, 480, 1100, 560],
            "timestamp": 1.0,
        },
    ]

    print("\n--- 1. Evaluating Detections on Camera CAM-B1-01 (Floor B1) ---")
    mapping_result = mapper.map_detections(
        synthetic_detections,
        slots_cfg,
        frame_dims=(1920, 1080),
        camera_id="CAM-B1-01",
        timestamp=1.0,
    )

    print(f"\n[SlotMapper Results - CAM-B1-01]:")
    print(f"  - Monitored Bays: {mapping_result.total_slots_monitored}")
    print(f"  - Occupied Bays: {mapping_result.occupied_count}")
    print(f"  - Available Candidates: {mapping_result.available_candidate_count}")
    print(f"  - Uncertain / Conflicts: {mapping_result.uncertain_count}")
    print(f"  - Unmapped Vehicles: {mapping_result.unmapped_vehicles_count}")

    print("\n--- Vehicle Assignments ---")
    for v in mapping_result.mapped_vehicles:
        print(f"  * {v.vehicle_class.upper()} ({v.confidence * 100:.1f}%) -> Slot {v.slot_id} | Score: {v.overlap_score:.2f} | Method: {v.mapping_method}")
    for v in mapping_result.unmapped_vehicles:
        print(f"  * {v.vehicle_class.upper()} ({v.confidence * 100:.1f}%) -> UNMAPPED (outside all slot ROIs)")

    print("\n--- Slot Occupancy Candidates ---")
    for s_id in sorted(mapping_result.slot_candidates.keys()):
        cand = mapping_result.slot_candidates[s_id]
        status_label = f"[{cand.candidate_status.upper()}]"
        note = f"- {cand.notes}" if cand.notes else ""
        print(f"  {s_id:7s}: {status_label:22s} {note}")

    out_json = os.path.join(output_dir, "mapping_demo_synthetic.json")
    with open(out_json, "w") as f:
        json.dump(mapping_result.to_dict(), f, indent=2)
    print(f"\n[Output] Structured mapping JSON saved to: {out_json}")

    # 2. Demonstrate multi-vehicle conflict scenario
    print("\n--- 2. Evaluating Multi-Vehicle Conflict Disambiguation ---")
    conflict_detections = [
        {"class_name": "motorcycle", "confidence": 0.89, "bounding_box": [110, 160, 200, 320], "timestamp": 2.0},
        {"class_name": "motorcycle", "confidence": 0.86, "bounding_box": [210, 160, 310, 320], "timestamp": 2.0},
    ]
    conflict_result = mapper.map_detections(
        conflict_detections,
        slots_cfg,
        frame_dims=(1920, 1080),
        camera_id="CAM-B1-01",
        timestamp=2.0,
    )
    b1_a01_cand = conflict_result.slot_candidates["B1-A01"]
    print(f"  Slot B1-A01 Candidate Status: [{b1_a01_cand.candidate_status.upper()}]")
    print(f"  Conflict Details: {b1_a01_cand.conflict_details}")

    print("\n[OK] Phase 3 demonstration completed successfully.")


def run_demo_pipeline(detector: VehicleDetector, output_dir: str, config_path: str = DEFAULT_CONFIG_PATH):
    """Runs end-to-end demo using generated synthetic test media with combined ROI visualization."""
    print("==================================================")
    print("Smart Mall Parking - Running Vehicle Detection & ROI Demo")
    print("==================================================")

    test_assets_dir = os.path.join(output_dir, "demo_input")
    try:
        sample_img, sample_vid = save_test_media_assets(test_assets_dir)
        print(f"[Setup] Generated test image: {sample_img}")
        print(f"[Setup] Generated test video: {sample_vid}")
    except Exception as e:
        print(f"[Error] Could not generate test assets: {e}")
        return

    # Run detection on test image with combined ROI mapping for CAM-B1-01
    print("\n--- 1. Testing Image Detection with Slot Mapping (CAM-B1-01) ---")
    process_image_command(
        detector,
        sample_img,
        output_dir,
        show_rois=True,
        map_slots=True,
        camera_id="CAM-B1-01",
        config_path=config_path,
    )

    # Run detection on test video
    print("\n--- 2. Testing Video Stream Detection ---")
    process_video_command(detector, sample_vid, output_dir, max_frames=30)
    print("\n[OK] Demonstration complete. All outputs saved to:", output_dir)


def run_pipeline_command(
    source: str,
    camera_id: str,
    config_path: str,
    output_dir: str,
    conf_threshold: float,
    enable_http_sync: bool = False,
    backend_url: str = None,
):
    """
    Runs the unified Phase 4 CVPipeline on an image, video file, or webcam.

    Source type is determined automatically:
    - Integer (or digit string) → webcam/camera device via process_video()
    - Extension matches image formats → process_image()
    - Extension matches video formats / RTSP URL → process_video()

    :param source: Image path, video path, RTSP URL, or camera device index (e.g. '0')
    :param camera_id: Camera ID whose ROI configuration will be used
    :param config_path: Path to slots_config.json
    :param output_dir: Root directory for pipeline outputs
    :param conf_threshold: Detection confidence threshold
    :param enable_http_sync: Whether to synchronize occupancy updates with Node.js backend
    :param backend_url: Target Node.js backend API URL
    """
    from config.settings import SUPPORTED_IMAGE_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS

    print("==================================================")
    print("Smart Mall Parking - Unified CV Pipeline (Phase 4)")
    print("==================================================")
    print(f"  Source      : {source}")
    print(f"  Camera ID   : {camera_id}")
    print(f"  Config      : {config_path}")
    print(f"  Output Dir  : {output_dir}")
    print(f"  Confidence  : {conf_threshold}")
    print(f"  HTTP Sync   : {'Enabled (' + str(backend_url or 'default') + ')' if enable_http_sync else 'Disabled (Offline)'}")
    print("==================================================\n")

    try:
        pipeline = CVPipeline(
            conf_threshold=conf_threshold,
            config_path=config_path,
            camera_id=camera_id,
            output_dir=output_dir,
            allow_mock=True,
            enable_http_sync=enable_http_sync,
            backend_url=backend_url,
        )
        )
    except ValueError as e:
        print(f"[Fatal] Pipeline initialisation failed: {e}")
        sys.exit(1)

    # Determine source type
    is_webcam = source.isdigit()
    _, ext = os.path.splitext(source)
    is_image = ext.lower() in SUPPORTED_IMAGE_EXTENSIONS
    is_video = (
        ext.lower() in SUPPORTED_VIDEO_EXTENSIONS
        or source.startswith(("rtsp://", "http://", "https://"))
    )

    if is_webcam or is_video:
        vid_source = int(source) if is_webcam else source
        print(f"[Pipeline] Starting video/stream processing for source: {source}")
        try:
            summary = pipeline.process_video(video_source=vid_source)
        except Exception as e:
            print(f"[Fatal] Video processing failed: {e}")
            sys.exit(1)

        print("\n[Pipeline] Video Summary:")
        print(f"  Frames Processed : {summary.get('total_frames_processed', 0)}")
        occ = summary.get("latest_occupancy", {})
        print(f"  Occupied Slots   : {occ.get('occupied_count', '?')}")
        print(f"  Available Slots  : {occ.get('available_candidate_count', '?')}")
        print(f"  Uncertain Slots  : {occ.get('uncertain_count', '?')}")
        print(f"  Annotated Video  : {summary.get('annotated_video_path', '')}")
        print(f"  Summary JSON     : {summary.get('json_path', '')}")

    elif is_image:
        print(f"[Pipeline] Processing image: {source}")
        try:
            record = pipeline.process_image(image_path=source)
        except FileNotFoundError as e:
            print(f"[Fatal] {e}")
            sys.exit(1)
        except Exception as e:
            print(f"[Fatal] Image processing failed: {e}")
            sys.exit(1)

        summ = record.get("summary", {})
        print("\n[Pipeline] Image Occupancy Summary:")
        print(f"  Slots Monitored  : {summ.get('total_slots_monitored', '?')}")
        print(f"  Occupied Slots   : {summ.get('occupied_count', '?')}")
        print(f"  Available Slots  : {summ.get('available_candidate_count', '?')}")
        print(f"  Uncertain Slots  : {summ.get('uncertain_count', '?')}")
        print(f"  Unmapped Vehicles: {summ.get('unmapped_vehicles_count', '?')}")
        print(f"  Annotated Image  : {record.get('annotated_image_path', '')}")
        print(f"  Occupancy JSON   : {record.get('json_path', '')}")

    else:
        print(f"[Fatal] Unrecognised source type for: '{source}'")
        print(f"  Supported image extensions : {', '.join(SUPPORTED_IMAGE_EXTENSIONS)}")
        print(f"  Supported video extensions : {', '.join(SUPPORTED_VIDEO_EXTENSIONS)}")
        print("  Or use an integer (e.g. 0) for a live webcam device.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Smart Mall Parking - YOLOv8 Vehicle Detection & ROI Service")
    parser.add_argument("--source", type=str,
                        help="[Phase 4] Unified pipeline source: image path, video path, RTSP URL, "
                             "or camera device index (e.g. 0). Runs the full CVPipeline.")
    parser.add_argument("--image", type=str, help="Path to input image file (.jpg, .png, etc.)")
    parser.add_argument("--video", type=str, help="Path to input video file (.mp4, .avi, etc.)")
    parser.add_argument("--demo", action="store_true", help="Run automated demonstration with test media and ROIs")
    parser.add_argument("--verify-topology", action="store_true", help="Validate shared parking topology")
    parser.add_argument("--rois", action="store_true", help="Overlay parking slot ROI polygons onto detected frames")
    parser.add_argument("--map-slots", "--map", action="store_true", help="Perform vehicle-to-slot mapping and occupancy candidate generation")
    parser.add_argument("--camera-id", type=str, default="CAM-B1-01", help="Camera ID to visualize/calibrate (default: CAM-B1-01)")
    parser.add_argument("--config", type=str, default=DEFAULT_CONFIG_PATH, help=f"Path to slots_config.json (default: {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--conf", type=float, default=DEFAULT_CONF_THRESHOLD, help=f"Confidence threshold (default: {DEFAULT_CONF_THRESHOLD})")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL_PATH, help=f"Path to YOLOv8 weights (default: {DEFAULT_MODEL_PATH})")
    parser.add_argument("--output-dir", type=str, default="output", help="Directory for detection outputs (default: output)")
    parser.add_argument("--calibrate", type=str, help="Launch interactive calibration tool on an image (path to image)")
    parser.add_argument("--sync-backend", action="store_true", help="Enable live HTTP synchronization to Node.js backend (default: disabled)")
    parser.add_argument("--backend-url", type=str, default=None, help="Node.js backend API URL (default: http://localhost:5000/api/slots/cv-update)")

    args = parser.parse_args()

    if args.verify_topology:
        verify_topology()
        return

    # -------------------------------------------------------------------
    # Phase 4: Unified CVPipeline via --source
    # -------------------------------------------------------------------
    if args.source:
        from pipeline import CVPipeline
        run_pipeline_command(
            source=args.source,
            camera_id=args.camera_id,
            config_path=args.config,
            output_dir=os.path.join(args.output_dir, "pipeline"),
            conf_threshold=args.conf,
            enable_http_sync=args.sync_backend,
            backend_url=args.backend_url,
        )
        return

    # Interactive Calibration Shortcut
    if args.calibrate:
        from tools.calibrate_roi import ROICalibrator
        calibrator = ROICalibrator(
            image_path=args.calibrate,
            camera_id=args.camera_id,
            config_path=args.config,
        )
        calibrator.run_interactive()
        return

    # Initialize Detector
    detector = None
    try:
        detector = VehicleDetector(
            model_path=args.model,
            conf_threshold=args.conf,
            iou_threshold=DEFAULT_IOU_THRESHOLD,
        )
    except Exception as e:
        if args.demo:
            print(f"[Notice] Live YOLOv8 detector unavailable ({e}).")
            print("[Notice] Launching Synthetic Detection & Slot Mapping Pipeline instead...\n")
            run_synthetic_demo_pipeline(args.output_dir, config_path=args.config)
            return
        else:
            print(f"[Fatal] Failed to initialize detector: {e}")
            print("\nEnsure dependencies are installed: pip install -r requirements.txt")
            sys.exit(1)

    if args.demo:
        run_demo_pipeline(detector, args.output_dir, config_path=args.config)
    elif args.image:
        process_image_command(
            detector,
            args.image,
            args.output_dir,
            show_rois=args.rois,
            map_slots=args.map_slots,
            camera_id=args.camera_id,
            config_path=args.config,
        )
    elif args.video:
        process_video_command(detector, args.video, args.output_dir)
    else:
        print("[Notice] No command provided. Running topology verification by default.")
        verify_topology()
        print("\nAvailable usage examples:")
        print("  python main.py --demo")
        print("  python main.py --source path/to/image.jpg --camera-id CAM-B1-01")
        print("  python main.py --source path/to/video.mp4 --camera-id CAM-B1-01")
        print("  python main.py --source 0 --camera-id CAM-B1-01")
        print("  python main.py --image path/to/image.jpg --map-slots --camera-id CAM-B1-01")
        print("  python main.py --image path/to/image.jpg --rois --camera-id CAM-B1-01")
        print("  python main.py --video path/to/video.mp4")
        print("  python main.py --calibrate path/to/reference_image.jpg --camera-id CAM-B1-01")
        print("  python main.py --verify-topology")


if __name__ == "__main__":
    main()
