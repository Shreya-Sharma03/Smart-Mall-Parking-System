"""
YOLOv8-Based Vehicle Detector for Smart Mall Parking System

Detects vehicles (cars, motorcycles) using Ultralytics YOLOv8
with COCO class filtering and structured output generation.
"""

import os
import time
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Union, Dict, Any

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

from config.settings import (
    DEFAULT_MODEL_PATH,
    TARGET_CLASSES,
    DEFAULT_CONF_THRESHOLD,
    DEFAULT_IOU_THRESHOLD,
    SUPPORTED_IMAGE_EXTENSIONS,
)


@dataclass
class DetectionResult:
    """
    Structured representation of a single vehicle detection.
    """
    class_name: str
    confidence: float
    bounding_box: Tuple[int, int, int, int]  # (x1, y1, x2, y2)
    frame_timestamp: float
    class_id: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert detection result to serializable dictionary."""
        return {
            "class_name": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "bounding_box": [int(c) for c in self.bounding_box],
            "frame_timestamp": round(float(self.frame_timestamp), 3),
            "class_id": int(self.class_id),
        }


@dataclass
class FrameDetections:
    """
    Structured container for all vehicle detections in a single frame.
    """
    frame_timestamp: float
    detections: List[DetectionResult]
    total_vehicles: int
    car_count: int
    motorcycle_count: int
    inference_time_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "frame_timestamp": round(float(self.frame_timestamp), 3),
            "total_vehicles": self.total_vehicles,
            "car_count": self.car_count,
            "motorcycle_count": self.motorcycle_count,
            "inference_time_ms": round(float(self.inference_time_ms), 2),
            "detections": [d.to_dict() for d in self.detections],
        }


class VehicleDetector:
    """
    Vehicle detector utilizing YOLOv8 with COCO class filtering.
    Filters specifically for:
      - Class 2: Car
      - Class 3: Motorcycle
    """

    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        conf_threshold: float = DEFAULT_CONF_THRESHOLD,
        iou_threshold: float = DEFAULT_IOU_THRESHOLD,
        device: str = "cpu",
    ):
        """
        Initialize the vehicle detector.

        :param model_path: Path to the YOLOv8 weights (.pt file)
        :param conf_threshold: Minimum detection confidence (0.0 - 1.0)
        :param iou_threshold: Intersection-over-Union threshold for NMS
        :param device: Execution device ('cpu' or 'cuda')
        """
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.device = device
        self.model = None

        self._initialize_model()

    def _initialize_model(self):
        """Validates environment and initializes YOLO model weights."""
        if YOLO is None:
            raise ImportError(
                "Ultralytics library is not installed. "
                "Install dependencies via: pip install -r requirements.txt"
            )

        if cv2 is None or np is None:
            raise ImportError(
                "OpenCV and NumPy are required for vehicle detection. "
                "Install dependencies via: pip install -r requirements.txt"
            )

        # Check if local weights exist, else fallback to standard yolov8n
        weights = self.model_path
        if not os.path.exists(weights):
            fallback_weights = "yolov8n.pt"
            print(f"[VehicleDetector] Model weights '{weights}' not found locally. Using '{fallback_weights}'.")
            weights = fallback_weights

        try:
            self.model = YOLO(weights)
            print(f"[VehicleDetector] YOLOv8 model loaded successfully ({weights}) on device '{self.device}'.")
        except Exception as e:
            raise RuntimeError(f"[VehicleDetector] Failed to load YOLOv8 model: {e}")

    def detect_frame(
        self,
        frame: Any,
        timestamp: float = 0.0,
    ) -> FrameDetections:
        """
        Perform vehicle detection on an individual image frame (numpy ndarray).

        :param frame: BGR image as a NumPy ndarray
        :param timestamp: Video timestamp or capture time in seconds
        :returns: FrameDetections structured container
        """
        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            raise ValueError("[VehicleDetector] Invalid frame: Input must be a non-empty numpy array.")

        start_time = time.time()

        # Run inference restricting target classes to COCO 2 (car) and 3 (motorcycle)
        results = self.model.predict(
            source=frame,
            classes=list(TARGET_CLASSES.keys()),
            conf=self.conf_threshold,
            iou=self.iou_threshold,
            device=self.device,
            verbose=False,
        )

        inference_time_ms = (time.time() - start_time) * 1000.0

        detections: List[DetectionResult] = []

        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None and len(boxes) > 0:
                xyxy = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                classes = boxes.cls.cpu().numpy().astype(int)

                for box, conf, cls_id in zip(xyxy, confs, classes):
                    if cls_id in TARGET_CLASSES:
                        class_name = TARGET_CLASSES[cls_id]
                        x1, y1, x2, y2 = [int(coord) for coord in box]

                        detections.append(
                            DetectionResult(
                                class_name=class_name,
                                confidence=float(conf),
                                bounding_box=(x1, y1, x2, y2),
                                frame_timestamp=float(timestamp),
                                class_id=int(cls_id),
                            )
                        )

        car_count = sum(1 for d in detections if d.class_name == "car")
        motorcycle_count = sum(1 for d in detections if d.class_name == "motorcycle")

        return FrameDetections(
            frame_timestamp=timestamp,
            detections=detections,
            total_vehicles=len(detections),
            car_count=car_count,
            motorcycle_count=motorcycle_count,
            inference_time_ms=inference_time_ms,
        )

    def detect_image(
        self,
        image_path: str,
    ) -> Tuple[FrameDetections, Any]:
        """
        Perform vehicle detection on an image from disk.

        :param image_path: Path to the image file
        :returns: Tuple of (FrameDetections, original_bgr_frame)
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"[VehicleDetector] Image file not found: {image_path}")

        _, ext = os.path.splitext(image_path)
        if ext.lower() not in SUPPORTED_IMAGE_EXTENSIONS:
            raise ValueError(
                f"[VehicleDetector] Unsupported image format '{ext}'. "
                f"Supported: {', '.join(SUPPORTED_IMAGE_EXTENSIONS)}"
            )

        frame = cv2.imread(image_path)
        if frame is None:
            raise ValueError(f"[VehicleDetector] Could not decode image file: {image_path}")

        detections = self.detect_frame(frame, timestamp=0.0)
        return detections, frame
