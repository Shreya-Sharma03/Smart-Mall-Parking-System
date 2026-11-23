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
import { PARKING_GRAPH } from '../data/parkingGraph.js';
import { dijkstra } from '../algorithms/dijkstra.js';
import {
  getRecommendedSlots,
  getBackendRecommendedSlots,
  calculateEstimatedTime,
} from '../services/recommendationService.js';
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
  const [activeReservationId, setActiveReservationId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_RES) || null;
    } catch {
      return null;
    }
  });

  const [reservationModalSlot, setReservationModalSlot] = useState(null);

  // ── Recommendation state ──────────────────────────────────────────────────
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

  // ── Compute recommendation from backend or local Dijkstra fallback ────────
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
        setRecommendation(backendRec);
      } else {
        const localRec = getRecommendedSlots({
          slots,
          gateId: selectedGate,
          vehicleType,
          accessibleOnly,
        });
        setRecommendation(localRec);
      }
    } catch {
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

  useEffect(() => {
    computeRecommendation();
  }, [computeRecommendation]);

  // ── Helper to calculate route to a given slot ─────────────────────────────
  const calculateRouteToSlot = useCallback((slot, gateId = selectedGate) => {
    if (!slot) return null;
    const routeResult = dijkstra(PARKING_GRAPH, gateId, slot.slotId);
    if (!routeResult || !routeResult.reachable) return null;

    const est = calculateEstimatedTime(routeResult.distance);
    return {
      slot,
      path: routeResult.path,
      distance: routeResult.distance,
      estimatedTime: est.formatted,
      estimatedTimeDesc: est.description,
      requiresFloorChange: routeResult.path.some((n) => n.includes('R1')),
    };
  }, [selectedGate]);

  // ── Synchronize activeRoute when recommendation or gate changes ───────────
  useEffect(() => {
    if (!recommendation || !recommendation.success || !recommendation.best) {
      return;
    }

    if (activeRoute) {
      const currentDestId = activeRoute.slot.slotId;
      const slot = slots.find((s) => s.slotId === currentDestId);
      if (slot && slot.status === 'available') {
        const updated = calculateRouteToSlot(slot, selectedGate);
        if (updated) setActiveRoute(updated);
      } else {
        setActiveRoute(recommendation.best);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGate, recommendation]);

  // ── Clear drawer if the selected slot no longer matches filters ──────────
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
    if (selectedSlotId) {
      const currentSlot = slots.find((s) => s.slotId === selectedSlotId);
      if (currentSlot && currentSlot.status === 'available') {
        const newRoute = calculateRouteToSlot(currentSlot, gateId);
        if (newRoute) {
          setActiveRoute(newRoute);
          return;
        }
      }
    }
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
    if (selectedSlotId === slot.slotId) {
      setSelectedSlotId(null);
      return;
    }

    setSelectedSlotId(slot.slotId);

    // If clicking an available slot, immediately compute and highlight the route to it!
    if (slot.status === 'available') {
      const newRoute = calculateRouteToSlot(slot);
      if (newRoute) {
        setActiveRoute(newRoute);
      }
    }
  };

  const handleNavigateToSlot = (slot) => {
    const newRoute = calculateRouteToSlot(slot);
    if (newRoute) {
      setActiveRoute(newRoute);
      setSelectedSlotId(slot.slotId);
    }
  };

  // ── Route visualization ───────────────────────────────────────────────────
  const handleToggleRoute = (candidate) => {
    if (activeRoute && activeRoute.slot.slotId === candidate.slot.slotId) {
      setActiveRoute(null);
    } else {
      setActiveRoute(candidate);
      setSelectedSlotId(candidate.slot.slotId);
      if (candidate.slot.floor !== activeFloor) {
        setActiveFloor(candidate.slot.floor);
      }
    }
  };

  const handleSelectAlternative = (altCandidate) => {
    setActiveRoute(altCandidate);
    setSelectedSlotId(altCandidate.slot.slotId);
    if (altCandidate.slot.floor !== activeFloor) {
      setActiveFloor(altCandidate.slot.floor);
    }
  };

  const handleFindBestSlot = () => {
    if (recommendation?.success && recommendation.best) {
      setActiveRoute(recommendation.best);
      setSelectedSlotId(recommendation.best.slot.slotId);
      if (recommendation.best.slot.floor !== activeFloor) {
        setActiveFloor(recommendation.best.slot.floor);
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
      // storage unavailable
    }

    setReservationModalSlot(null);
    refresh();

    if (createdReservation.slotId) {
      setSelectedSlotId(createdReservation.slotId);
      if (createdReservation.floor && createdReservation.floor !== activeFloor) {
        setActiveFloor(createdReservation.floor);
      }
    }
  };

  const handleReservationCancelled = () => {
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
          <p className="loading-label">Loading real-time parking data…</p>
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

      {/* Active Visitor Reservation Banner */}
      {activeReservationId && (
        <ActiveReservationBanner
          activeReservationId={activeReservationId}
          onReservationCancelled={handleReservationCancelled}
          onReservationDismissed={handleReservationDismissed}
          onRefreshSlots={refresh}
        />
      )}

      <main className="visitor-portal-body">
        {/* ── Left Column: Preferences, Recommendation & Inspector ───── */}
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
                  <h3 className="rec-title">Finding Shortest Route…</h3>
                  <span className="rec-sub">Calculating shortest path</span>
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
            />
          )}

          {/* Selected Slot Inspector */}
          {selectedSlot ? (
            <SlotDetailsDrawer
              slot={selectedSlot}
              onClose={() => setSelectedSlotId(null)}
              onOpenReservation={handleOpenReservation}
              onNavigateToSlot={handleNavigateToSlot}
              isNavigating={Boolean(activeRoute && activeRoute.slot.slotId === selectedSlot.slotId)}
            />
          ) : (
            <div className="select-slot-prompt-card">
              <div className="prompt-icon-wrap">
                <Info size={18} />
              </div>
              <div>
                <h4 className="prompt-title">Interactive Slot Inspector</h4>
                <p className="prompt-desc">
                  Click any parking bay on the blueprint map to inspect its real-time
                  status, calculate direct navigation, or reserve it for 30 minutes.
                </p>
              </div>
            </div>
          )}

          {/* Mall Tip Card */}
          <div className="mall-tip-card">
            <div className="tip-header">
              <Sparkles size={14} />
              <span>Visitor Guide</span>
            </div>
            <p className="tip-body">
              {activeFloor === 'B1'
                ? 'Basement 1 connects Gate A and Gate B. Ramp B1-R1 provides direct transit down to Basement 2.'
                : 'Basement 2 is reached via Ramp B1-R1. Follow signs along the main circulation aisle.'}
            </p>
          </div>
        </aside>

        {/* ── Right Column: CAD Floor Map Canvas & Route Overlay ─────── */}
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

          {/* Interactive CAD Blueprint Map with Dynamic Highlighted Route */}
          <ParkingFloorMap
            floor={activeFloor}
            slots={slots}
            selectedSlotId={selectedSlotId}
            onSelectSlot={handleSelectSlot}
            vehicleType={vehicleType}
            accessibleOnly={accessibleOnly}
            activeRoute={activeRoute}
            onSwitchFloor={setActiveFloor}
            selectedGate={selectedGate}
            onSelectGate={handleSelectGate}
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
