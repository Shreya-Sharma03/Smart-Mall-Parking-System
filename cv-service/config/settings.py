"""
Computer Vision Service Configuration Settings
"""

import os
from typing import Dict, List

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
DEFAULT_MODEL_PATH = os.path.join(MODELS_DIR, "yolov8n.pt")

# COCO Vehicle Classes to Detect
# Class 2: car, Class 3: motorcycle
TARGET_CLASSES: Dict[int, str] = {
    2: "car",
    3: "motorcycle",
}

# Detection Thresholds
DEFAULT_CONF_THRESHOLD: float = 0.45
DEFAULT_IOU_THRESHOLD: float = 0.45

# Visualizer Bounding Box Colors (BGR format for OpenCV)
CLASS_COLORS: Dict[str, tuple] = {
    "car": (0, 230, 64),        # Vivid Green
    "motorcycle": (255, 191, 0), # Deep Amber / Cyan
    "default": (0, 165, 255),    # Orange
}

# Supported image and video extensions
SUPPORTED_IMAGE_EXTENSIONS: List[str] = [
    ".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"
]

SUPPORTED_VIDEO_EXTENSIONS: List[str] = [
    ".mp4", ".avi", ".mov", ".mkv", ".wmv"
]
