import React, { useState, useMemo, useEffect } from 'react';
import Header from '../components/Header';
import VisitorPreferences from '../components/VisitorPreferences';
import FloorSwitcher from '../components/FloorSwitcher';
import StatusLegend from '../components/StatusLegend';
import ParkingFloorMap from '../components/ParkingFloorMap';
import SlotDetailsDrawer from '../components/SlotDetailsDrawer';
import RecommendationCard from '../components/RecommendationCard';
import RouteOverlay from '../components/RouteOverlay';
import { INITIAL_MOCK_SLOTS, computeFloorStats } from '../data/mockSlots.js';
import { getRecommendedSlots } from '../services/recommendationService.js';
import { Sparkles, Info } from 'lucide-react';

export default function VisitorDashboard() {
  const [slots, setSlots] = useState(INITIAL_MOCK_SLOTS);
  const [activeFloor, setActiveFloor] = useState('B1');
  const [selectedGate, setSelectedGate] = useState('B1-GA');
  const [vehicleType, setVehicleType] = useState('car');
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);

  // Active route state
  const [activeRoute, setActiveRoute] = useState(null);

  // Compute floor stats synchronized with active filters
  const floorStats = useMemo(() => ({
    B1: computeFloorStats(slots, 'B1', vehicleType, accessibleOnly),
    B2: computeFloorStats(slots, 'B2', vehicleType, accessibleOnly),
  }), [slots, vehicleType, accessibleOnly]);

  // Compute total available slots matching current preferences
  const matchingAvailableCount = useMemo(() => {
    return slots.filter((slot) => {
      const isAvailable = slot.status === 'available';
      const matchesVehicle = slot.vehicleType.includes(vehicleType);
      const matchesAccessible = !accessibleOnly || slot.accessible === true;
      return isAvailable && matchesVehicle && matchesAccessible;
    }).length;
  }, [slots, vehicleType, accessibleOnly]);

  // Compute recommendation automatically on parameter changes
  const recommendation = useMemo(() => {
    return getRecommendedSlots({
      slots,
      gateId: selectedGate,
      vehicleType,
      accessibleOnly,
    });
  }, [slots, selectedGate, vehicleType, accessibleOnly]);

  // Clear or synchronize active route whenever recommendation changes
  useEffect(() => {
    if (!recommendation.success || !recommendation.best) {
      // Clear route if no recommendation is valid
      setActiveRoute(null);
      return;
    }

    if (activeRoute) {
      // Check if current active route still satisfies the new recommendation
      const isStillBest = activeRoute.slot.slotId === recommendation.best.slot.slotId;
      const stillInAlternatives = recommendation.alternatives.find(
        (alt) => alt.slot.slotId === activeRoute.slot.slotId
      );

      if (isStillBest) {
        setActiveRoute(recommendation.best);
      } else if (stillInAlternatives) {
        setActiveRoute(stillInAlternatives);
      } else {
        // Active route no longer matches current filters
        setActiveRoute(null);
      }
    }
  }, [recommendation]);

  // Clear inspected slot drawer if it does not match active filters
  useEffect(() => {
    if (selectedSlotId) {
      const slot = slots.find((s) => s.slotId === selectedSlotId);
      if (
        !slot ||
        !slot.vehicleType.includes(vehicleType) ||
        (accessibleOnly && !slot.accessible)
      ) {
        setSelectedSlotId(null);
      }
    }
  }, [vehicleType, accessibleOnly, slots, selectedSlotId]);

  // Preference change handlers that reset stale navigation state
  const handleSelectGate = (gateId) => {
    setSelectedGate(gateId);
    setActiveRoute(null);
    setSelectedSlotId(null);
  };

  const handleSelectVehicle = (type) => {
    setVehicleType(type);
    setActiveRoute(null);
    setSelectedSlotId(null);
  };

  const handleToggleAccessible = (isAccessible) => {
    setAccessibleOnly(isAccessible);
    setActiveRoute(null);
    setSelectedSlotId(null);
  };

  const currentFloorStats = floorStats[activeFloor];
  const selectedSlot = slots.find((s) => s.slotId === selectedSlotId) || null;

  const handleSelectSlot = (slot) => {
    if (selectedSlotId === slot.slotId) {
      setSelectedSlotId(null);
    } else {
      setSelectedSlotId(slot.slotId);
    }
  };

  // Toggle Route Visualization
  const handleToggleRoute = (candidate) => {
    if (activeRoute && activeRoute.slot.slotId === candidate.slot.slotId) {
      setActiveRoute(null);
    } else {
      setActiveRoute(candidate);
      setSelectedSlotId(candidate.slot.slotId);
    }
  };

  // Select alternative route
  const handleSelectAlternative = (altCandidate) => {
    setActiveRoute(altCandidate);
    setSelectedSlotId(altCandidate.slot.slotId);
  };

  // "Find Best Parking Slot" CTA button handler
  const handleFindBestSlot = () => {
    if (recommendation.success && recommendation.best) {
      setActiveRoute(recommendation.best);
      setSelectedSlotId(recommendation.best.slot.slotId);
      // If the slot is on B2 and user is on B1, stay on B1 or let them see Gate A route
      if (recommendation.best.slot.floor === 'B2' && activeFloor !== 'B1') {
        setActiveFloor('B1'); // Start at gate on B1
      }
    } else {
      setActiveRoute(null);
      setSelectedSlotId(null);
    }
  };

  return (
    <div className="visitor-portal">
      <Header />

      <main className="visitor-portal-body">
        {/* Left Column: Preferences, Recommendation Card & Selected Slot Details */}
        <aside className="portal-sidebar">
          {/* Trip Preferences Selector */}
          <VisitorPreferences
            selectedGate={selectedGate}
            onSelectGate={handleSelectGate}
            vehicleType={vehicleType}
            onSelectVehicle={handleSelectVehicle}
            accessibleOnly={accessibleOnly}
            onToggleAccessible={handleToggleAccessible}
            matchingAvailableCount={matchingAvailableCount}
            onFindBestSlot={handleFindBestSlot}
          />

          {/* Recommendation Card */}
          <RecommendationCard
            recommendation={recommendation}
            isRouteActive={Boolean(activeRoute)}
            onToggleRoute={handleToggleRoute}
            onSelectAlternative={handleSelectAlternative}
            activeRouteSlotId={activeRoute?.slot?.slotId}
          />

          {/* Selected Slot Inspector */}
          {selectedSlot ? (
            <SlotDetailsDrawer
              slot={selectedSlot}
              onClose={() => setSelectedSlotId(null)}
            />
          ) : (
            <div className="select-slot-prompt-card">
              <div className="prompt-icon-wrap">
                <Info size={22} />
              </div>
              <div>
                <h4 className="prompt-title">Interactive Slot Inspector</h4>
                <p className="prompt-desc">
                  Click any parking bay on the blueprint map to inspect its real-time status, vehicle compatibility, and aisle location.
                </p>
              </div>
            </div>
          )}

          {/* Mall Tip Card */}
          <div className="mall-tip-card">
            <div className="tip-header">
              <Sparkles size={16} />
              <span>Smart Mall Navigation</span>
            </div>
            <p className="tip-body">
              {activeFloor === 'B1'
                ? 'Basement 1 connects Gate A and Gate B. Ramp B1-R1 leads down to Basement 2.'
                : 'Basement 2 is reached via Ramp B1-R1. Follow corridor signs from Junction B2-J2.'}
            </p>
          </div>
        </aside>

        {/* Right Column: Navigation Sequence, Floor Controls, Legend & 2D Floor Map */}
        <section className="portal-map-area">
          {/* Active Navigation Route Bar & Breadcrumbs */}
          {activeRoute && (
            <RouteOverlay
              activeRoute={activeRoute}
              currentFloor={activeFloor}
              onSwitchFloor={setActiveFloor}
              onClearRoute={() => setActiveRoute(null)}
            />
          )}

          {/* Floor Tabs & Status Legend */}
          <div className="map-controls-row">
            <FloorSwitcher
              activeFloor={activeFloor}
              onSelectFloor={setActiveFloor}
              floorStats={floorStats}
            />

            <StatusLegend
              counts={{
                available: currentFloorStats.available,
                occupied: currentFloorStats.occupied,
                reserved: currentFloorStats.reserved,
                maintenance: currentFloorStats.maintenance,
              }}
            />
          </div>

          {/* Interactive 2D Blueprint Map */}
          <ParkingFloorMap
            floor={activeFloor}
            slots={slots}
            selectedSlotId={selectedSlotId}
            onSelectSlot={handleSelectSlot}
            vehicleType={vehicleType}
            accessibleOnly={accessibleOnly}
            activeRoute={activeRoute}
          />
        </section>
      </main>
    </div>
  );
}
