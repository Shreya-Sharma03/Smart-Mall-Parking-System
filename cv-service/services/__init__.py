"""
Services module for CV detection, occupancy management, and backend adapters.
"""

from services.occupancy_adapter import (
    OccupancyAdapter,
    normalize_vehicle_type,
    get_iso_timestamp,
    OPERATIONAL_STATUSES,
)
from services.api_client import (
    BackendApiClient,
    DispatchResult,
    PendingSlotUpdate,
)

__all__ = [
    "OccupancyAdapter",
    "normalize_vehicle_type",
    "get_iso_timestamp",
    "OPERATIONAL_STATUSES",
    "BackendApiClient",
    "DispatchResult",
    "PendingSlotUpdate",
]
