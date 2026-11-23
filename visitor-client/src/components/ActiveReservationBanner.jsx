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
  Navigation,
} from 'lucide-react';
import { fetchReservationById, cancelReservation } from '../services/reservationService.js';

export default function ActiveReservationBanner({
  activeReservationId,
  onReservationCancelled,
  onReservationDismissed,
  onRefreshSlots,
  onNavigateToSlot,
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
    if (!reservation || isCancelling) return;

    setIsCancelling(true);
    setCancelError(null);

    try {
      await cancelReservation(reservation.reservationId || reservation._id);
      setShowCancelPrompt(false);
      onReservationCancelled();
      onReservationDismissed();
    } catch (err) {
      setCancelError(err.message || 'Failed to cancel reservation. Please try again.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="active-res-banner loading-banner">
        <Loader2 size={16} className="spin" />
        <span>Loading active reservation details…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="active-res-banner error-banner">
        <AlertTriangle size={16} />
        <span>{error}</span>
        <button
          type="button"
          className="btn-dismiss-banner"
          onClick={onReservationDismissed}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (!reservation) return null;

  const isExpired = timeRemaining.isExpired || reservation.status === 'expired';
  const isCancelled = reservation.status === 'cancelled';

  return (
    <div className={`active-res-banner ${isExpired ? 'is-expired' : ''}`}>
      <div className="banner-left">
        <div className="res-badge-icon">
          <ShieldCheck size={20} />
        </div>
        <div>
          <div className="banner-res-title">
            <span>Active Reservation: <strong>Bay {reservation.slotId}</strong></span>
            <span className="banner-res-plate">{reservation.vehicleNumber}</span>
          </div>
          <div className="banner-res-meta">
            <span>Guest: {reservation.customerName}</span>
            <span className="meta-dot">•</span>
            <span>Floor {reservation.floor || (reservation.slotId?.startsWith('B2') ? 'B2' : 'B1')}</span>
            <span className="meta-dot">•</span>
            <span>Type: {reservation.vehicleType === 'bike' ? 'Two-Wheeler' : 'Four-Wheeler'}</span>
          </div>
        </div>
      </div>

      <div className="banner-center">
        {!isExpired && !isCancelled ? (
          <div className="countdown-pill" title="Time remaining before hold expires">
            <Clock size={16} className="clock-tick" />
            <div className="countdown-numbers">
              <span className="countdown-value">
                {String(timeRemaining.minutes).padStart(2, '0')}:
                {String(timeRemaining.seconds).padStart(2, '0')}
              </span>
              <span className="countdown-unit">REMAINING</span>
            </div>
          </div>
        ) : (
          <div className="countdown-pill expired-pill">
            <XCircle size={16} />
            <span>HOLD EXPIRED</span>
          </div>
        )}
      </div>

      <div className="banner-right">
        {!isExpired && !isCancelled && !showCancelPrompt && (
          <button
            type="button"
            className="btn-cancel-reservation-prompt"
            onClick={() => setShowCancelPrompt(true)}
          >
            Cancel Booking
          </button>
        )}

        {showCancelPrompt && (
          <div className="cancel-confirm-group">
            <span className="confirm-text">Release this bay?</span>
            <button
              type="button"
              className="btn-confirm-cancel"
              onClick={handleConfirmCancel}
              disabled={isCancelling}
            >
              {isCancelling ? 'Releasing…' : 'Yes, Cancel'}
            </button>
            <button
              type="button"
              className="btn-abort-cancel"
              onClick={() => setShowCancelPrompt(false)}
              disabled={isCancelling}
            >
              Back
            </button>
          </div>
        )}

        {(isExpired || isCancelled) && (
          <button
            type="button"
            className="btn-dismiss-banner"
            onClick={onReservationDismissed}
          >
            Dismiss
          </button>
        )}
      </div>

      {cancelError && (
        <div className="banner-cancel-error">
          <span>{cancelError}</span>
        </div>
      )}
    </div>
  );
}
