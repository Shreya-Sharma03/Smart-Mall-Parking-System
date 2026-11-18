import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  Clock,
  MapPin,
  Car,
  Bike,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { fetchReservationById, cancelReservation } from '../services/reservationService.js';

export default function ActiveReservationBanner({
  activeReservationId,
  onReservationCancelled,
  onReservationDismissed,
  onRefreshSlots,
}) {
  const [reservation, setReservation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState(null);
  const [cancelError, setCancelError] = useState(null);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState({ minutes: 0, seconds: 0, isExpired: false });

  const timerRef = useRef(null);

  // Load reservation details from backend whenever activeReservationId changes
  const loadReservation = useCallback(async (resId) => {
    if (!resId) {
      setReservation(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setCancelError(null);

    try {
      const data = await fetchReservationById(resId);
      setReservation(data);
    } catch (err) {
      if (err.status === 404) {
        // Reservation not found in database (e.g. wiped or invalid ID)
        setError('Saved reservation was not found on the server.');
      } else {
        setError(err.message || 'Unable to load reservation details.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeReservationId) {
      loadReservation(activeReservationId);
    } else {
      setReservation(null);
    }
  }, [activeReservationId, loadReservation]);

  // Authoritative countdown timer using backend-provided expiryTime
  useEffect(() => {
    if (!reservation || !reservation.expiryTime) {
      setTimeRemaining({ minutes: 0, seconds: 0, isExpired: false });
      return;
    }

    const calculateTime = () => {
      const expiryMs = new Date(reservation.expiryTime).getTime();
      const nowMs = Date.now();
      const diffMs = expiryMs - nowMs;

      if (diffMs <= 0 || reservation.status === 'expired' || reservation.status === 'cancelled') {
        setTimeRemaining({ minutes: 0, seconds: 0, isExpired: true });
        return;
      }

      const totalSec = Math.floor(diffMs / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;

      setTimeRemaining({ minutes, seconds, isExpired: false });
    };

    calculateTime();
    timerRef.current = setInterval(calculateTime, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [reservation]);

  // Handle Cancellation
  const handleConfirmCancel = async () => {
    if (isCancelling || !reservation?.reservationId) return;

    setIsCancelling(true);
    setCancelError(null);

    try {
      const result = await cancelReservation(reservation.reservationId);
      setReservation((prev) => (prev ? { ...prev, status: 'cancelled', cancelledAt: result.cancelledAt } : null));
      setShowCancelPrompt(false);

      // Trigger immediate refresh of parking slots so the bay returns to 'available' on the floor map
      if (onRefreshSlots) {
        onRefreshSlots();
      }

      // Notify parent to update/clear storage if needed
      if (onReservationCancelled) {
        onReservationCancelled(reservation.reservationId);
      }
    } catch (err) {
      setCancelError(err.message || 'Failed to cancel reservation.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (!activeReservationId) return null;

  if (isLoading) {
    return (
      <div className="active-res-banner banner-loading">
        <div className="active-res-left">
          <Loader2 size={18} className="spin" />
          <span>Retrieving your active reservation details…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="active-res-banner banner-error">
        <div className="active-res-left">
          <AlertTriangle size={18} className="text-warning" />
          <div>
            <strong>Reservation Lookup:</strong>
            <span> {error}</span>
          </div>
        </div>
        <div className="active-res-actions">
          <button
            type="button"
            className="btn-res-action btn-res-dismiss"
            onClick={onReservationDismissed}
          >
            Clear Stored Booking
          </button>
        </div>
      </div>
    );
  }

  if (!reservation) return null;

  const isExpired = timeRemaining.isExpired || reservation.status === 'expired';
  const isCancelled = reservation.status === 'cancelled';
  const isActive = reservation.status === 'active' && !isExpired;

  return (
    <div
      className={`active-res-banner ${
        isActive ? 'banner-active' : isExpired ? 'banner-expired' : 'banner-cancelled'
      }`}
    >
      <div className="active-res-content-grid">
        {/* Left: Identity and status badge */}
        <div className="active-res-identity">
          <div className="active-res-badge-wrap">
            {isActive ? (
              <ShieldCheck size={22} className="res-icon-active" />
            ) : isExpired ? (
              <Clock size={22} className="res-icon-expired" />
            ) : (
              <XCircle size={22} className="res-icon-cancelled" />
            )}
          </div>
          <div>
            <div className="active-res-title-row">
              <span className="active-res-label">YOUR RESERVATION</span>
              <span
                className={`active-res-status-tag tag-${
                  isActive ? 'active' : isExpired ? 'expired' : 'cancelled'
                }`}
              >
                {isActive ? 'HOLD ACTIVE' : isExpired ? 'HOLD EXPIRED' : 'CANCELLED'}
              </span>
            </div>
            <div className="active-res-id-code">
              ID: <strong>{reservation.reservationId}</strong>
            </div>
          </div>
        </div>

        {/* Center: Slot & Vehicle Details */}
        <div className="active-res-details">
          <div className="res-detail-item">
            <span className="res-detail-label">
              <MapPin size={12} /> Reserved Bay
            </span>
            <span className="res-detail-val">
              {reservation.slotId} (Floor {reservation.floor})
            </span>
          </div>

          <div className="res-detail-item">
            <span className="res-detail-label">
              {reservation.vehicleType === 'bike' ? <Bike size={12} /> : <Car size={12} />} Vehicle
            </span>
            <span className="res-detail-val">{reservation.vehicleNumber}</span>
          </div>
        </div>

        {/* Right: Authoritative Countdown or Status Summary */}
        <div className="active-res-timer-cluster">
          {isActive ? (
            <div className="res-timer-box">
              <span className="res-timer-caption">TIME TO OCCUPY BAY</span>
              <span className="res-timer-countdown">
                {String(timeRemaining.minutes).padStart(2, '0')}:
                {String(timeRemaining.seconds).padStart(2, '0')}
              </span>
            </div>
          ) : isExpired ? (
            <div className="res-timer-box-expired">
              <span className="res-timer-caption">STATUS</span>
              <span className="res-timer-expired-text">Slot Released</span>
            </div>
          ) : (
            <div className="res-timer-box-cancelled">
              <span className="res-timer-caption">STATUS</span>
              <span className="res-timer-cancelled-text">Booking Cancelled</span>
            </div>
          )}

          {/* Action Area */}
          <div className="active-res-controls">
            {isActive && !showCancelPrompt && (
              <button
                type="button"
                className="btn-res-action btn-res-cancel"
                onClick={() => setShowCancelPrompt(true)}
              >
                Cancel Reservation
              </button>
            )}

            {isActive && showCancelPrompt && (
              <div className="active-res-confirm-prompt">
                <span className="confirm-text">Cancel and release bay?</span>
                <div className="confirm-btns">
                  <button
                    type="button"
                    className="btn-confirm-yes"
                    onClick={handleConfirmCancel}
                    disabled={isCancelling}
                  >
                    {isCancelling ? <Loader2 size={13} className="spin" /> : 'Yes, Cancel'}
                  </button>
                  <button
                    type="button"
                    className="btn-confirm-no"
                    onClick={() => setShowCancelPrompt(false)}
                    disabled={isCancelling}
                  >
                    Keep
                  </button>
                </div>
              </div>
            )}

            {(!isActive || isExpired || isCancelled) && (
              <button
                type="button"
                className="btn-res-action btn-res-dismiss"
                onClick={onReservationDismissed}
                title="Dismiss and book another slot"
              >
                Dismiss Notice
              </button>
            )}
          </div>
        </div>
      </div>

      {cancelError && (
        <div className="active-res-error-notice">
          <AlertTriangle size={14} />
          <span>{cancelError}</span>
        </div>
      )}
    </div>
  );
}
