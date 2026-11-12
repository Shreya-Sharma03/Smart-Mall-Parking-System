"""
Vehicle Detection Module for Smart Mall Parking System
"""

from .detector import VehicleDetector, DetectionResult, FrameDetections
from .video_processor import VideoProcessor
from .slot_mapper import (
    SlotMapper,
    SlotMapperConfig,
    MappedVehicle,
    SlotOccupancyCandidate,
    FrameMappingResult,
    calculate_bottom_center,
    is_point_in_polygon,
    polygon_area,
    clip_polygon_to_bbox,
    compute_polygon_intersection_and_iou,
    compute_bbox_intersection_and_iou,
    compute_bbox_iou,
)

__all__ = [
    "VehicleDetector",
    "DetectionResult",
    "FrameDetections",
    "VideoProcessor",
    "SlotMapper",
    "SlotMapperConfig",
    "MappedVehicle",
    "SlotOccupancyCandidate",
    "FrameMappingResult",
    "calculate_bottom_center",
    "is_point_in_polygon",
    "polygon_area",
    "clip_polygon_to_bbox",
    "compute_polygon_intersection_and_iou",
    "compute_bbox_intersection_and_iou",
    "compute_bbox_iou",
]
