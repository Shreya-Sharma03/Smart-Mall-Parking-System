"""
Synthetic Parking Media Generator for Local Testing

Creates realistic synthetic parking garage frames containing vehicles
for automated test suites and demonstration without external CCTV feeds.
"""

import os
from typing import Tuple, Any

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None


def generate_synthetic_parking_frame(
    width: int = 1280,
    height: int = 720,
    with_vehicles: bool = True,
) -> Any:
    """
    Renders a synthetic top-down / isometric parking aisle image.

    :param width: Image width
    :param height: Image height
    :param with_vehicles: Whether to paint vehicle shapes into the parking bays
    :returns: OpenCV BGR image (NumPy array)
    """
    if cv2 is None or np is None:
        raise ImportError("OpenCV and NumPy are required to generate synthetic media.")

    # 1. Dark asphalt background
    frame = np.full((height, width, 3), (35, 38, 45), dtype=np.uint8)

    # 2. Draw driving aisle center thoroughfare
    cv2.rectangle(frame, (0, 260), (width, 460), (25, 27, 32), -1)

    # 3. Draw dashed lane divider
    for x in range(20, width, 60):
        cv2.line(frame, (x, 360), (x + 30, 360), (120, 180, 240), 2)

    # 4. Draw parking bay lines (Top row and Bottom row)
    num_bays = 6
    bay_width = (width - 100) // num_bays

    for i in range(num_bays + 1):
        x = 50 + i * bay_width
        # Top bays
        cv2.line(frame, (x, 40), (x, 260), (230, 230, 230), 3)
        # Bottom bays
        cv2.line(frame, (x, 460), (x, 680), (230, 230, 230), 3)

    if with_vehicles:
        # Paint Car in Top Bay 1 (x: 70..220, y: 70..240)
        cv2.rectangle(frame, (70, 70), (210, 235), (40, 60, 180), -1)      # Car body (Red/Navy)
        cv2.rectangle(frame, (85, 95), (195, 175), (20, 30, 80), -1)       # Car roof/windshield
        cv2.circle(frame, (90, 75), 8, (200, 240, 255), -1)                # Headlights
        cv2.circle(frame, (190, 75), 8, (200, 240, 255), -1)

        # Paint Car in Top Bay 3 (x: 450..590, y: 70..240)
        cv2.rectangle(frame, (450, 70), (590, 235), (190, 190, 190), -1)   # Silver Car
        cv2.rectangle(frame, (465, 95), (575, 175), (60, 60, 60), -1)      # Windshield

        # Paint Motorcycle in Bottom Bay 2 (x: 270..340, y: 480..630)
        cv2.rectangle(frame, (280, 485), (325, 620), (20, 160, 220), -1)   # Yellow/Orange Bike
        cv2.circle(frame, (302, 500), 12, (30, 30, 30), -1)                # Front wheel

        # Paint Car in Bottom Bay 4 (x: 640..780, y: 485..650)
        cv2.rectangle(frame, (640, 485), (780, 650), (45, 130, 50), -1)    # Green SUV
        cv2.rectangle(frame, (655, 510), (765, 595), (20, 50, 20), -1)

    return frame


def save_test_media_assets(output_dir: str) -> Tuple[str, str]:
    """
    Generates and saves sample test image and sample test video to disk.

    :param output_dir: Directory where test assets will be created
    :returns: Tuple of (test_image_path, test_video_path)
    """
    if cv2 is None or np is None:
        raise ImportError("OpenCV and NumPy are required to generate test media.")

    os.makedirs(output_dir, exist_ok=True)

    image_path = os.path.join(output_dir, "test_parking_scene.jpg")
    video_path = os.path.join(output_dir, "test_parking_stream.mp4")

    # 1. Create and save test image
    frame = generate_synthetic_parking_frame(width=1280, height=720, with_vehicles=True)
    cv2.imwrite(image_path, frame)

    # 2. Create and save short 2-second test video (30 frames/sec)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(video_path, fourcc, 15.0, (1280, 720))

    try:
        for i in range(30):
            # Slight camera jitter / motion simulation
            jitter_frame = frame.copy()
            if i % 2 == 0:
                cv2.circle(jitter_frame, (100 + i * 2, 360), 4, (0, 255, 255), -1)
            writer.write(jitter_frame)
    finally:
        writer.release()

    return image_path, video_path
