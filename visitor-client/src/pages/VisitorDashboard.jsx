import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Header from '../components/Header.jsx';
import VisitorPreferences from '../components/VisitorPreferences.jsx';
import FloorSwitcher from '../components/FloorSwitcher.jsx';
import StatusLegend from '../components/StatusLegend.jsx';
import ParkingFloorMap from '../components/ParkingFloorMap.jsx';
import SlotDetailsDrawer from '../components/SlotDetailsDrawer.jsx';
import RecommendationCard from '../components/RecommendationCard.jsx';
import RouteOverlay from '../components/RouteOverlay.jsx';
import DataSourceBanner from '../components/DataSourceBanner.jsx';
import ActiveReservationBanner from '../components/ActiveReservationBanner.jsx';
import ReservationModal from '../components/ReservationModal.jsx';
import useParking from '../hooks/useParking.js';
import { computeFloorStats } from '../data/mockSlots.js';
import { getRecommendedSlots, getBackendRecommendedSlots } from '../services/recommendationService.js';
import { Sparkles, Info } from 'lucide-react';

const STORAGE_KEY_ACTIVE_RES = 'smart_mall_active_res_id';

export default function VisitorDashboard() {
  // ── Live data hook ────────────────────────────────────────────────────────
  const {
    slots,
    isLoading,
    isRefreshing,
    error,
    isBackendOnline,
    lastUpdated,
    dataSource,
    refresh,
  } = useParking();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeFloor, setActiveFloor] = useState('B1');
  const [selectedGate, setSelectedGate] = useState('B1-GA');
  const [vehicleType, setVehicleType] = useState('car');
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [activeRoute, setActiveRoute] = useState(null);

  // ── Reservation State ─────────────────────────────────────────────────────
  // Store strictly the reservation ID in localStorage
  const [activeReservationId, setActiveReservationId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_RES) || null;
    } catch {
      return null;
    }
  });

  const [reservationModalSlot, setReservationModalSlot] = useState(null);

  // ── Recommendation state (backend preferred, local Dijkstra fallback) ─────
  const [recommendation, setRecommendation] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  // ── Derived: floor stats ──────────────────────────────────────────────────
  const floorStats = useMemo(() => ({
    B1: computeFloorStats(slots, 'B1', vehicleType, accessibleOnly),
    B2: computeFloorStats(slots, 'B2', vehicleType, accessibleOnly),
  }), [slots, vehicleType, accessibleOnly]);

  // ── Derived: total matching available count ───────────────────────────────
  const matchingAvailableCount = useMemo(() => {
    return slots.filter((slot) => {
      const isAvailable = slot.status === 'available';
      const matchesVehicle = Array.isArray(slot.vehicleType)
        ? slot.vehicleType.includes(vehicleType)
        : slot.vehicleType === vehicleType;
      const matchesAccessible = !accessibleOnly || slot.accessible === true;
      return isAvailable && matchesVehicle && matchesAccessible;
    }).length;
  }, [slots, vehicleType, accessibleOnly]);

  // ── Recommendation: attempt backend first, fall back to local Dijkstra ────
  const computeRecommendation = useCallback(async () => {
    if (slots.length === 0) return;
    setRecLoading(true);

    try {
      if (isBackendOnline) {
        const backendRec = await getBackendRecommendedSlots({
          gateId: selectedGate,
          vehicleType,
          accessibleOnly,
        });

        if (backendRec.success) {
          setRecommendation(backendRec);
          setRecLoading(false);
          return;
        }
        // Backend returned no results (all full/no match)
        setRecommendation(backendRec);
      } else {
        // Backend offline — run local Dijkstra on slot data
        const localRec = getRecommendedSlots({
          slots,
          gateId: selectedGate,
          vehicleType,
          accessibleOnly,
        });
        setRecommendation(localRec);
      }
    } catch {
      // Any unexpected error — fall back to local
      const localRec = getRecommendedSlots({
        slots,
        gateId: selectedGate,
        vehicleType,
        accessibleOnly,
      });
      setRecommendation(localRec);
    } finally {
      setRecLoading(false);
    }
  }, [slots, selectedGate, vehicleType, accessibleOnly, isBackendOnline]);

  // Recompute recommendation whenever its inputs change
  useEffect(() => {
    computeRecommendation();
  }, [computeRecommendation]);

  // ── Synchronize activeRoute when recommendation changes ───────────────────
  useEffect(() => {
    if (!recommendation || !recommendation.success || !recommendation.best) {
      setActiveRoute(null);
      return;
    }

    if (activeRoute) {
      const isStillBest = activeRoute.slot.slotId === recommendation.best.slot.slotId;
      const stillInAlts = recommendation.alternatives?.find(
        (alt) => alt.slot.slotId === activeRoute.slot.slotId
      );

      if (isStillBest) {
        setActiveRoute(recommendation.best);
      } else if (stillInAlts) {
        setActiveRoute(stillInAlts);
      } else {
        setActiveRoute(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation]);

  // ── Clear drawer if the slot no longer matches filters ───────────────────
  useEffect(() => {
    if (selectedSlotId) {
      const slot = slots.find((s) => s.slotId === selectedSlotId);
      const matchesVehicle = Array.isArray(slot?.vehicleType)
        ? slot.vehicleType.includes(vehicleType)
        : slot?.vehicleType === vehicleType;
      if (!slot || !matchesVehicle || (accessibleOnly && !slot.accessible)) {
        setSelectedSlotId(null);
      }
    }
  }, [vehicleType, accessibleOnly, slots, selectedSlotId]);

  // ── Preference handlers ───────────────────────────────────────────────────
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

  // ── Slot interaction ──────────────────────────────────────────────────────
  const currentFloorStats = floorStats[activeFloor];
  const selectedSlot = slots.find((s) => s.slotId === selectedSlotId) || null;

  const handleSelectSlot = (slot) => {
    setSelectedSlotId(selectedSlotId === slot.slotId ? null : slot.slotId);
  };

  // ── Route visualization ───────────────────────────────────────────────────
  const handleToggleRoute = (candidate) => {
    if (activeRoute && activeRoute.slot.slotId === candidate.slot.slotId) {
      setActiveRoute(null);
    } else {
      setActiveRoute(candidate);
      setSelectedSlotId(candidate.slot.slotId);
    }
  };

  const handleSelectAlternative = (altCandidate) => {
    setActiveRoute(altCandidate);
    setSelectedSlotId(altCandidate.slot.slotId);
  };

  const handleFindBestSlot = () => {
    if (recommendation?.success && recommendation.best) {
      setActiveRoute(recommendation.best);
      setSelectedSlotId(recommendation.best.slot.slotId);
      if (recommendation.best.slot.floor === 'B2' && activeFloor !== 'B1') {
        setActiveFloor('B1');
      }
    } else {
      setActiveRoute(null);
      setSelectedSlotId(null);
    }
  };

  // ── Reservation Handlers ──────────────────────────────────────────────────
  const handleOpenReservation = (slotToReserve) => {
    setReservationModalSlot(slotToReserve);
  };

  const handleCloseReservationModal = () => {
    setReservationModalSlot(null);
  };

  const handleReservationSuccess = (createdReservation) => {
    const resId = createdReservation.reservationId;
    setActiveReservationId(resId);
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_RES, resId);
    } catch {
      // storage unavailable / quota exceeded
    }

    setReservationModalSlot(null);

    // Refresh slot availability immediately from backend so the map reflects status 'reserved'
    refresh();

    // Select the newly reserved slot so the user can inspect it
    if (createdReservation.slotId) {
      setSelectedSlotId(createdReservation.slotId);
      if (createdReservation.floor && createdReservation.floor !== activeFloor) {
        setActiveFloor(createdReservation.floor);
      }
    }
  };

  const handleReservationCancelled = () => {
    // Refresh slot availability immediately
    refresh();
  };

  const handleReservationDismissed = () => {
    setActiveReservationId(null);
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_RES);
    } catch {
      // ignore
    }
  };

  // ── Full-page loading skeleton (first fetch only) ─────────────────────────
  if (isLoading) {
    return (
      <div className="visitor-portal">
        <Header isBackendOnline={null} isRefreshing={false} />
        <div className="dashboard-loading-state">
          <div className="loading-spinner" />
          <p className="loading-label">Loading parking data…</p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="visitor-portal">
      <Header
        isBackendOnline={isBackendOnline}
        isRefreshing={isRefreshing}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      {/* Data source / error banner */}
      <DataSourceBanner
        dataSource={dataSource}
        error={error}
        isRefreshing={isRefreshing}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      {/* Active Visitor Reservation Banner (Restored via ID from localStorage) */}
      {activeReservationId && (
        <ActiveReservationBanner
          activeReservationId={activeReservationId}
          onReservationCancelled={handleReservationCancelled}
          onReservationDismissed={handleReservationDismissed}
          onRefreshSlots={refresh}
        />
      )}

      <main className="visitor-portal-body">
        {/* ── Left Column ───────────────────────────────────────────── */}
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
          {recLoading ? (
            <div className="recommendation-card empty-state rec-loading-state">
              <div className="recommendation-header">
                <div className="loading-spinner-sm" />
                <div>
                  <h3 className="rec-title">Finding Best Route…</h3>
                  <span className="rec-sub">Running Dijkstra shortest path</span>
                </div>
              </div>
            </div>
          ) : (
            <RecommendationCard
              recommendation={recommendation}
              isRouteActive={Boolean(activeRoute)}
              onToggleRoute={handleToggleRoute}
              onSelectAlternative={handleSelectAlternative}
              activeRouteSlotId={activeRoute?.slot?.slotId}
              onOpenReservation={handleOpenReservation}
            />
          )}

          {/* Selected Slot Inspector */}
          {selectedSlot ? (
            <SlotDetailsDrawer
              slot={selectedSlot}
              onClose={() => setSelectedSlotId(null)}
              onOpenReservation={handleOpenReservation}
            />
          ) : (
            <div className="select-slot-prompt-card">
              <div className="prompt-icon-wrap">
                <Info size={22} />
              </div>
              <div>
                <h4 className="prompt-title">Interactive Slot Inspector</h4>
                <p className="prompt-desc">
                  Click any parking bay on the blueprint map to inspect its real-time
                  status, vehicle compatibility, or book a 30-minute reservation.
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

        {/* ── Right Column ──────────────────────────────────────────── */}
        <section className="portal-map-area">
          {/* Active Navigation Route Bar */}
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

      {/* Reservation Form Modal */}
      {reservationModalSlot && (
        <ReservationModal
          slot={reservationModalSlot}
          preferredVehicleType={vehicleType}
          isOpen={Boolean(reservationModalSlot)}
          onClose={handleCloseReservationModal}
          onSuccess={handleReservationSuccess}
        />
      )}
    </div>
  );
}
