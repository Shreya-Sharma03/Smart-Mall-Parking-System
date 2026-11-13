"""
Unified Computer Vision Pipeline
Milestone 4 - Phase 4: Smart Mall Parking Management System

Connects:
  Input (Image, Video, Live Stream)
    -> OpenCV Frame Capture
    -> YOLOv8 Vehicle Detection
    -> Camera ROI Configuration & Topology Loading
    -> Vehicle-to-Slot Mapping (Bottom-center + Exact Polygon Clipping)
    -> Camera Occupancy Candidate Generation
    -> Structured JSON Export + Annotated Frame Visualization
"""

import os
import sys
import json
import time
import math
from typing import Dict, Any, List, Tuple, Optional, Union, Generator

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from config.topology import ALL_SLOT_IDS, FLOORS
from config.settings import (
    DEFAULT_MODEL_PATH,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_IOU_THRESHOLD,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_VIDEO_EXTENSIONS,
    DEFAULT_BACKEND_URL,
    DEFAULT_HTTP_TIMEOUT,
)
from detection.detector import VehicleDetector, DetectionResult, FrameDetections
from detection.slot_mapper import (
    SlotMapper,
    SlotMapperConfig,
    MappedVehicle,
    SlotOccupancyCandidate,
    FrameMappingResult,
)
from detection.tracker import VehicleTracker, TrackerConfig, TrackedVehicle
from detection.occupancy_stabilizer import OccupancyStabilizer, StabilizerConfig, SlotTemporalState
from utils.roi_utils import (
    load_slots_config,
    get_camera_slots,
    DEFAULT_CONFIG_PATH,
)
from utils.visualizer import draw_mapping_results
from services.occupancy_adapter import OccupancyAdapter
from services.api_client import BackendApiClient


class CVPipeline:
    """
    Unified Computer Vision Pipeline for Smart Mall Parking Management.
    Processes individual frames, image files, video files, or live camera streams.
    """

    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        config_path: str = DEFAULT_CONFIG_PATH,
        camera_id: str = "CAM-B1-01",
        output_dir: str = "outputs",
        slot_mapper_config: Optional[SlotMapperConfig] = None,
        allow_mock: bool = True,
        detector: Optional[VehicleDetector] = None,
        slot_mapper: Optional[SlotMapper] = None,
        tracker: Optional[VehicleTracker] = None,
        tracker_config: Optional[TrackerConfig] = None,
        stabilizer: Optional[OccupancyStabilizer] = None,
        stabilizer_config: Optional[StabilizerConfig] = None,
        override_statuses: Optional[Dict[str, str]] = None,
        enable_http_sync: bool = False,
        backend_url: Optional[str] = None,
        http_timeout: float = DEFAULT_HTTP_TIMEOUT,
        api_client: Optional[BackendApiClient] = None,
    ):
        """
        Initializes the unified pipeline components once (caching model and ROIs).

        :param model_path: Path to YOLOv8 weights (.pt file)
        :param conf_threshold: Detection confidence threshold
        :param config_path: Path to slots_config.json
        :param camera_id: Target camera ID to monitor (e.g. 'CAM-B1-01')
        :param output_dir: Root directory for outputs (images, videos, json)
        :param slot_mapper_config: Custom SlotMapperConfig thresholds
        :param allow_mock: Fallback to mock detection if Ultralytics is not installed
        :param detector: Optional pre-configured VehicleDetector instance
        :param slot_mapper: Optional pre-configured SlotMapper instance
        :param tracker: Optional pre-configured VehicleTracker instance
        :param tracker_config: Custom TrackerConfig thresholds
        :param stabilizer: Optional pre-configured OccupancyStabilizer instance
        :param stabilizer_config: Custom StabilizerConfig thresholds
        :param override_statuses: Map of slot_id -> 'reserved'|'maintenance'
        :param enable_http_sync: Whether to synchronize occupancy updates with Node.js backend
        :param backend_url: Target Node.js backend API URL (default: http://localhost:5000/api/slots/cv-update)
        :param http_timeout: HTTP request timeout in seconds
        :param api_client: Optional pre-configured BackendApiClient instance
        """
        self.camera_id = camera_id
        self.config_path = config_path
        self.output_dir = output_dir

        # Setup structured output directories
        self.images_dir = os.path.join(self.output_dir, "images")
        self.videos_dir = os.path.join(self.output_dir, "videos")
        self.json_dir = os.path.join(self.output_dir, "json")
        os.makedirs(self.images_dir, exist_ok=True)
        os.makedirs(self.videos_dir, exist_ok=True)
        os.makedirs(self.json_dir, exist_ok=True)

        # 1. Load and cache ROI configuration
        self.slots_config = load_slots_config(self.config_path)
        self._validate_camera_id()

        # 2. Initialize Slot Mapper once
        self.slot_mapper_config = slot_mapper_config or SlotMapperConfig()
        self.slot_mapper = slot_mapper or SlotMapper(config=self.slot_mapper_config)

        # 3. Initialize Vehicle Tracker & Occupancy Stabilizer (Milestone 5)
        self.tracker_config = tracker_config or TrackerConfig()
        self.tracker = tracker or VehicleTracker(config=self.tracker_config)

        self.stabilizer_config = stabilizer_config or StabilizerConfig()
        self.stabilizer = stabilizer or OccupancyStabilizer(
            config=self.stabilizer_config,
            override_statuses=override_statuses,
        )

        # 4. Initialize Occupancy Adapter (Backend Integration Output Preparation)
        self.occupancy_adapter = OccupancyAdapter(
            camera_id=self.camera_id,
            slots_config=self.slots_config,
        )

        # 5. Initialize Optional HTTP API Client (Default: Disabled for offline workflows)
        self.enable_http_sync = enable_http_sync
        if api_client is not None:
            self.api_client = api_client
        elif self.enable_http_sync:
            self.api_client = BackendApiClient(
                backend_url=backend_url or DEFAULT_BACKEND_URL,
                timeout=http_timeout,
            )
        else:
            self.api_client = None

        # 6. Initialize Vehicle Detector once
        if detector is not None:
            self.detector = detector
        else:
            try:
                self.detector = VehicleDetector(
                    model_path=model_path,
                    conf_threshold=conf_threshold,
                    iou_threshold=DEFAULT_IOU_THRESHOLD,
                )
            except Exception as e:
                if allow_mock:
                    print(f"[Pipeline] Notice: YOLOv8 detector unavailable ({e}). Operating in simulation mode.")
                    self.detector = None
                else:
                    raise RuntimeError(f"[Pipeline] Failed to initialize detector: {e}")

    def _validate_camera_id(self) -> None:
        """Ensures camera_id exists within the loaded ROI configuration."""
        configured_cameras = [
            cam.get("cameraId") for cam in self.slots_config.get("cameras", [])
        ]
        if self.camera_id not in configured_cameras:
            raise ValueError(
                f"[Pipeline] Camera ID '{self.camera_id}' not found in ROI configuration. "
                f"Configured cameras: {', '.join(configured_cameras)}"
            )

    def process_frame(
        self,
        frame: Any,
        frame_number: int = 1,
        timestamp: float = 0.0,
        custom_detections: Optional[List[Any]] = None,
    ) -> Tuple[Dict[str, Any], Any]:
        """
        Processes a single BGR frame through the complete pipeline:
          1. Detects vehicles (or uses custom/synthetic detections)
          2. Maps vehicles to parking slot ROIs
          3. Generates occupancy candidates
          4. Generates structured serializable JSON record
          5. Generates annotated visualization with HUD

        :param frame: Target OpenCV BGR image (numpy ndarray)
        :param frame_number: Sequential frame number
        :param timestamp: Video timestamp or capture time in seconds
        :param custom_detections: Optional list of DetectionResult objects (for testing)
        :returns: Tuple (frame_record_dict, annotated_frame)
        """
        if frame is None or not hasattr(frame, "shape"):
            raise ValueError("[Pipeline] Invalid frame: Input must be a valid image array.")

        h, w = frame.shape[:2]
        if h <= 0 or w <= 0:
            raise ValueError(f"[Pipeline] Invalid frame dimensions: {w}x{h}")

        # 1. Detection Stage
        if custom_detections is not None:
            raw_detections = custom_detections
            inference_ms = 0.0
        elif self.detector is not None:
            frame_dets = self.detector.detect_frame(frame, timestamp=timestamp)
            raw_detections = frame_dets.detections
            inference_ms = frame_dets.inference_time_ms
        else:
            # Fallback mock detector if neither live detector nor custom detections given
            raw_detections = []
            inference_ms = 0.0

        # 2. Tracking Stage (Milestone 5)
        active_tracks = self.tracker.update(raw_detections, timestamp=timestamp)

        # Prepare tracked detections for SlotMapper
        if active_tracks:
            dets_to_map = [
                {
                    "class_name": t.class_name,
                    "confidence": t.confidence,
                    "bounding_box": t.bounding_box,
                    "timestamp": timestamp,
                    "track_id": t.track_id,
                }
                for t in active_tracks
            ]
        else:
            dets_to_map = raw_detections

        # 3. Slot Mapping Stage
        mapping_result = self.slot_mapper.map_detections(
            detections=dets_to_map,
            slots_config=self.slots_config,
            frame_dims=(w, h),
            camera_id=self.camera_id,
            timestamp=timestamp,
        )

        # Update tracker slot associations
        for v in mapping_result.mapped_vehicles:
            if v.track_id and v.slot_id:
                self.tracker.associate_slot(v.track_id, v.slot_id)

        # 4. Occupancy Stabilization Stage (Milestone 5)
        stabilized_states = self.stabilizer.update(
            mapping_result=mapping_result,
            tracked_vehicles=active_tracks,
        )

        # 5. Format Structured Output (Section 6 Specification)
        mapped_by_box = {
            tuple(int(c) for c in v.bounding_box): v
            for v in mapping_result.mapped_vehicles
        }

        detections_list: List[Dict[str, Any]] = []
        for det in raw_detections:
            if isinstance(det, DetectionResult):
                bbox = [int(c) for c in det.bounding_box]
                cls_name = str(det.class_name)
                conf = float(det.confidence)
            elif isinstance(det, dict):
                bbox = [int(c) for c in det.get("bounding_box", (0, 0, 0, 0))]
                cls_name = str(det.get("class_name", "car"))
                conf = float(det.get("confidence", 1.0))
            else:
                continue

            mapped_v = mapped_by_box.get(tuple(bbox))
            detections_list.append({
                "vehicle_class": cls_name,
                "confidence": round(conf, 4),
                "bounding_box": bbox,
                "slot_id": mapped_v.slot_id if mapped_v else None,
                "track_id": mapped_v.track_id if mapped_v else None,
                "mapping_score": round(float(mapped_v.overlap_score), 4) if mapped_v else 0.0,
                "mapping_method": mapped_v.mapping_method if mapped_v else "unmapped",
                "occupancy_candidate": mapped_v.occupancy_candidate if mapped_v else "unmapped",
            })

        # Slot Candidates & Conflict Extraction
        slot_candidates_dict: Dict[str, Dict[str, Any]] = {}
        mapping_conflicts: List[Dict[str, Any]] = []

        for s_id, cand in mapping_result.slot_candidates.items():
            claimants_count = sum(
                1 for v in mapping_result.mapped_vehicles if v.slot_id == s_id
            )
            is_conf = bool(
                cand.conflict_details is not None or cand.candidate_status == "uncertain"
            )

            stab_state = stabilized_states.get(s_id)
            slot_candidates_dict[s_id] = {
                "slot_id": str(s_id),
                "floor": str(cand.floor),
                "camera_id": str(cand.camera_id),
                "candidate_status": str(cand.candidate_status),
                "confirmed_status": str(stab_state.confirmed_status) if stab_state else str(cand.candidate_status),
                "confirmation_progress": str(stab_state.confirmation_progress) if stab_state else "",
                "consecutive_occupied_frames": int(stab_state.consecutive_occupied_frames) if stab_state else 0,
                "consecutive_available_frames": int(stab_state.consecutive_available_frames) if stab_state else 0,
                "associated_track_id": stab_state.associated_track_id if stab_state else None,
                "mapped_vehicle_count": int(claimants_count),
                "is_conflict": is_conf,
            }

            if is_conf:
                mapping_conflicts.append({
                    "slot_id": s_id,
                    "candidate_status": cand.candidate_status,
                    "details": cand.conflict_details or cand.notes,
                })

        # Assemble Full Frame Record (Strictly JSON Serializable)
        frame_record: Dict[str, Any] = {
            "frame_number": int(frame_number),
            "timestamp": round(float(timestamp), 3),
            "camera_id": str(self.camera_id),
            "floor": str(mapping_result.floor),
            "inference_time_ms": round(float(inference_ms), 2),
            "summary": {
                "total_slots_monitored": int(mapping_result.total_slots_monitored),
                "occupied_count": int(mapping_result.occupied_count),
                "available_candidate_count": int(mapping_result.available_candidate_count),
                "uncertain_count": int(mapping_result.uncertain_count),
                "unmapped_vehicles_count": int(mapping_result.unmapped_vehicles_count),
                "unmonitored_count": int(getattr(mapping_result, "unmonitored_count", 0)),
                "active_tracks_count": int(len(active_tracks)),
                "stabilized_occupied_count": sum(1 for s in stabilized_states.values() if s.is_monitored and s.confirmed_status == "occupied"),
                "stabilized_available_count": sum(1 for s in stabilized_states.values() if s.is_monitored and s.confirmed_status == "available"),
                "stabilized_uncertain_count": sum(1 for s in stabilized_states.values() if s.is_monitored and s.confirmed_status == "uncertain"),
            },
            "detections": detections_list,
            "tracked_vehicles": [t.to_dict() for t in active_tracks],
            "mapped_vehicles": [v.to_dict() for v in mapping_result.mapped_vehicles],
            "unmapped_vehicles": [v.to_dict() for v in mapping_result.unmapped_vehicles],
            "slot_occupancy_candidates": slot_candidates_dict,
            "stabilized_slot_occupancy": {
                s_id: state.to_dict() for s_id, state in stabilized_states.items()
            },
            "mapping_conflicts": mapping_conflicts,
        }

        # Backend-Ready Normalized Occupancy Representation
        normalized_snapshot = self.occupancy_adapter.get_normalized_snapshot(
            stabilized_states=stabilized_states,
            timestamp=timestamp,
        )
        occupancy_transitions = self.occupancy_adapter.detect_status_transitions(
            stabilized_states=stabilized_states,
            timestamp=timestamp,
        )
        backend_request_payload = self.occupancy_adapter.build_backend_payload(
            stabilized_states=stabilized_states,
            timestamp=timestamp,
        )

        frame_record["backend_payload"] = normalized_snapshot
        frame_record["backend_request"] = backend_request_payload
        frame_record["occupancy_transitions"] = occupancy_transitions

        # 6. Optional HTTP Synchronization with Node.js Backend
        http_sync_result = None
        if self.enable_http_sync and self.api_client is not None:
            dispatch = self.api_client.sync_occupancy(
                adapter=self.occupancy_adapter,
                stabilized_states=stabilized_states,
                timestamp=timestamp,
            )
            if dispatch is not None:
                http_sync_result = dispatch.to_dict()

        frame_record["http_sync"] = http_sync_result

        # 7. Visualization Stage
        annotated_frame = draw_mapping_results(
            frame=frame,
            mapping_result=mapping_result,
            slots_config=self.slots_config,
            show_lines=True,
            show_confidence=True,
            frame_number=frame_number,
            stabilized_states=stabilized_states,
        )

        return frame_record, annotated_frame

    def process_image(
        self,
        image_path: str,
        output_image_name: Optional[str] = None,
        output_json_name: Optional[str] = None,
        custom_detections: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        """
        Processes a single parking lot image file.

        :param image_path: Path to input image file
        :param output_image_name: Custom filename for annotated image
        :param output_json_name: Custom filename for output JSON
        :param custom_detections: Optional list of detections (for testing)
        :returns: Frame record dictionary
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"[Pipeline] Image file not found: {image_path}")

        _, ext = os.path.splitext(image_path)
        if ext.lower() not in SUPPORTED_IMAGE_EXTENSIONS:
            raise ValueError(
                f"[Pipeline] Unsupported image extension '{ext}'. "
                f"Supported: {', '.join(SUPPORTED_IMAGE_EXTENSIONS)}"
            )

        if cv2 is None:
            raise ImportError("[Pipeline] OpenCV is required to read and save images.")

        frame = cv2.imread(image_path)
        if frame is None:
            raise ValueError(f"[Pipeline] Failed to decode image file (corrupt or unreadable): {image_path}")

        base_name = os.path.splitext(os.path.basename(image_path))[0]
        record, annotated = self.process_frame(
            frame=frame,
            frame_number=1,
            timestamp=0.0,
            custom_detections=custom_detections,
        )

        # Save annotated image
        img_out_name = output_image_name or f"annotated_{base_name}.jpg"
        img_out_path = os.path.join(self.images_dir, img_out_name)
        cv2.imwrite(img_out_path, annotated)
        print(f"[Pipeline] Annotated image saved to: {img_out_path}")

        # Save structured JSON
        json_out_name = output_json_name or f"occupancy_{base_name}.json"
        json_out_path = os.path.join(self.json_dir, json_out_name)
        with open(json_out_path, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)
        print(f"[Pipeline] Occupancy JSON saved to: {json_out_path}")

        record["annotated_image_path"] = img_out_path
        record["json_path"] = json_out_path
        return record

    def process_video(
        self,
        video_source: Union[str, int],
        output_video_name: Optional[str] = None,
        output_json_name: Optional[str] = None,
        max_frames: Optional[int] = None,
        frame_skip: int = 1,
        save_frame_records: bool = False,
    ) -> Dict[str, Any]:
        """
        Processes a video file, RTSP stream, or live webcam frame-by-frame.

        :param video_source: Video file path, RTSP URL, or integer camera device index (e.g. 0)
        :param output_video_name: Custom filename for annotated output video
        :param output_json_name: Custom filename for summary JSON
        :param max_frames: Max frames to process before stopping
        :param frame_skip: Process every Nth frame (default: 1)
        :param save_frame_records: Whether to include all frame-by-frame records in the final JSON
        :returns: Video processing summary dictionary
        """
        if cv2 is None:
            raise ImportError("[Pipeline] OpenCV is required for video processing.")

        # Resolve video source type
        is_live_camera = False
        if isinstance(video_source, int) or (isinstance(video_source, str) and video_source.isdigit()):
            capture_source = int(video_source)
            is_live_camera = True
            source_label = f"Camera_Device_{capture_source}"
        else:
            capture_source = str(video_source)
            source_label = os.path.splitext(os.path.basename(capture_source))[0]
            if not os.path.exists(capture_source) and not capture_source.startswith(("rtsp://", "http://", "https://")):
                raise FileNotFoundError(f"[Pipeline] Video source not found: {capture_source}")

        cap = cv2.VideoCapture(capture_source)
        if not cap.isOpened():
            raise RuntimeError(f"[Pipeline] Failed to open video source: {video_source}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0.0 or math.isnan(fps):
            fps = 25.0

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            width, height = 1280, 720

        # Setup video writer
        vid_out_name = output_video_name or f"annotated_{source_label}.mp4"
        vid_out_path = os.path.join(self.videos_dir, vid_out_name)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(vid_out_path, fourcc, fps / max(1, frame_skip), (width, height))

        if not writer.isOpened():
            cap.release()
            raise RuntimeError(f"[Pipeline] Failed to initialize VideoWriter at: {vid_out_path}")

        print(f"\n[Pipeline] Processing Video Source: {video_source}")
        print(f"  - Resolution: {width}x{height} @ {fps:.1f} FPS")
        print(f"  - Target Camera ID: {self.camera_id}")

        frame_count = 0
        processed_count = 0
        last_record: Optional[Dict[str, Any]] = None
        frame_records_list: List[Dict[str, Any]] = []

        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                frame_count += 1
                if frame_skip > 1 and (frame_count % frame_skip) != 0:
                    continue

                timestamp_sec = frame_count / fps
                processed_count += 1

                record, annotated = self.process_frame(
                    frame=frame,
                    frame_number=processed_count,
                    timestamp=timestamp_sec,
                )

                writer.write(annotated)
                last_record = record

                if save_frame_records:
                    frame_records_list.append(record)

                if processed_count % 30 == 0 or processed_count == 1:
                    summ = record["summary"]
                    print(f"  [Frame {processed_count:04d} | T={timestamp_sec:.2f}s] "
                          f"Occupied: {summ['occupied_count']}, Avail: {summ['available_candidate_count']}, "
                          f"Uncertain: {summ['uncertain_count']}, Unmapped: {summ['unmapped_vehicles_count']}")

                if max_frames and processed_count >= max_frames:
                    break

        finally:
            cap.release()
            writer.release()

        print(f"[Pipeline] Video processing finished. Processed {processed_count} frames.")
        print(f"[Pipeline] Annotated video saved to: {vid_out_path}")

        # Final JSON Summary
        summary_record = {
            "source": str(video_source),
            "camera_id": str(self.camera_id),
            "floor": last_record.get("floor", "B1") if last_record else "B1",
            "total_frames_processed": int(processed_count),
            "fps": round(float(fps), 2),
            "resolution": [int(width), int(height)],
            "latest_occupancy": last_record.get("summary", {}) if last_record else {},
            "latest_slot_candidates": last_record.get("slot_occupancy_candidates", {}) if last_record else {},
            "stabilized_occupancy": {s_id: s.to_dict() for s_id, s in self.stabilizer.slots_state.items()},
            "tracked_vehicles": [t.to_dict() for t in self.tracker.tracks],
            "confirmation_summary": self.stabilizer.get_summary_counts(),
            "backend_payload": self.occupancy_adapter.get_normalized_snapshot(
                stabilized_states=self.stabilizer.slots_state,
            ),
            "occupancy_transitions": self.occupancy_adapter.detect_status_transitions(
                stabilized_states=self.stabilizer.slots_state,
            ),
            "annotated_video_path": vid_out_path,
        }

        if save_frame_records:
            summary_record["frame_records"] = frame_records_list

        json_out_name = output_json_name or f"occupancy_video_{source_label}.json"
        json_out_path = os.path.join(self.json_dir, json_out_name)
        with open(json_out_path, "w", encoding="utf-8") as f:
            json.dump(summary_record, f, indent=2)
        print(f"[Pipeline] Video summary JSON saved to: {json_out_path}")

        summary_record["json_path"] = json_out_path
        return summary_record
