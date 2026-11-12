"""
Video Stream Processor for Vehicle Detection

Processes video files or camera streams frame-by-frame,
runs inference using VehicleDetector, and provides annotated output streams.
"""

import os
from typing import Generator, Tuple, Optional, Any

try:
    import cv2
except ImportError:
    cv2 = None

from detection.detector import VehicleDetector, FrameDetections
from utils.visualizer import draw_detections
from config.settings import SUPPORTED_VIDEO_EXTENSIONS


class VideoProcessor:
    """
    Handles video input, frame iteration, timestamp extraction,
    and video file re-encoding with detection annotations.
    """

    def __init__(self, detector: VehicleDetector):
        """
        :param detector: Configured VehicleDetector instance
        """
        self.detector = detector

    def process_video_stream(
        self,
        video_path: str,
        max_frames: Optional[int] = None,
        frame_skip: int = 1,
    ) -> Generator[Tuple[FrameDetections, Any], None, None]:
        """
        Yields detections and annotated frames sequentially from a video file.

        :param video_path: Path to video file (.mp4, .avi, etc.)
        :param max_frames: Optional frame limit
        :param frame_skip: Process every Nth frame (default: 1, every frame)
        :yields: (FrameDetections, annotated_frame)
        """
        if cv2 is None:
            raise ImportError("OpenCV is required to process video. Install opencv-python.")

        if not os.path.exists(video_path):
            raise FileNotFoundError(f"[VideoProcessor] Video file not found: {video_path}")

        _, ext = os.path.splitext(video_path)
        if ext.lower() not in SUPPORTED_VIDEO_EXTENSIONS:
            raise ValueError(
                f"[VideoProcessor] Unsupported video format '{ext}'. "
                f"Supported formats: {', '.join(SUPPORTED_VIDEO_EXTENSIONS)}"
            )

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"[VideoProcessor] Failed to open video file: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            fps = 30.0  # Fallback default FPS

        frame_count = 0
        processed_count = 0

        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                frame_count += 1

                # Skip frames if configured for performance
                if frame_skip > 1 and (frame_count % frame_skip) != 0:
                    continue

                timestamp_sec = frame_count / fps

                # Run vehicle detection
                detections = self.detector.detect_frame(frame, timestamp=timestamp_sec)

                # Draw annotations
                annotated_frame = draw_detections(frame, detections.detections)

                processed_count += 1
                yield detections, annotated_frame

                if max_frames and processed_count >= max_frames:
                    break
        finally:
            cap.release()

    def process_and_save_video(
        self,
        input_video_path: str,
        output_video_path: str,
        max_frames: Optional[int] = None,
    ) -> int:
        """
        Processes an input video and exports the fully annotated result to an output video.

        :param input_video_path: Source video path
        :param output_video_path: Destination video path
        :param max_frames: Optional frame limit
        :returns: Number of frames successfully processed and written
        """
        if cv2 is None:
            raise ImportError("OpenCV is required to export video. Install opencv-python.")

        cap = cv2.VideoCapture(input_video_path)
        if not cap.isOpened():
            raise ValueError(f"[VideoProcessor] Could not open input video: {input_video_path}")

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.release()

        # Ensure output directory exists
        out_dir = os.path.dirname(output_video_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))

        frames_written = 0
        try:
            for _, annotated in self.process_video_stream(input_video_path, max_frames=max_frames):
                writer.write(annotated)
                frames_written += 1
        finally:
            writer.release()

        return frames_written
