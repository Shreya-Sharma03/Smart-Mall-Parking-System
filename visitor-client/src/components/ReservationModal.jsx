import React, { useState, useEffect } from 'react';
import {
  X,
  Car,
  Bike,
  ShieldCheck,
  MapPin,
  Accessibility,
  AlertCircle,
  Loader2,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { createReservation } from '../services/reservationService.js';

export default function ReservationModal({
  slot,
  preferredVehicleType = 'car',
  isOpen,
  onClose,
  onSuccess,
}) {
  const [customerName, setCustomerName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('car');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorStatus, setErrorStatus] = useState(null);

  // Initialize and synchronize vehicle type based on slot support and visitor preference
  useEffect(() => {
    if (slot && isOpen) {
      setErrorMessage(null);
      setErrorStatus(null);
      const supported = Array.isArray(slot.vehicleType) ? slot.vehicleType : [slot.vehicleType || 'car'];

      if (supported.includes(preferredVehicleType)) {
        setVehicleType(preferredVehicleType);
      } else if (supported.length > 0) {
        setVehicleType(supported[0]);
      } else {
        setVehicleType('car');
      }
    }
  }, [slot, preferredVehicleType, isOpen]);

  // Handle ESC key to dismiss (only when not actively submitting)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !slot) return null;

  const supportedTypes = Array.isArray(slot.vehicleType)
    ? slot.vehicleType
    : [slot.vehicleType || 'car'];

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submissions
    if (isSubmitting) return;

    // Client-side validations
    const cleanName = customerName.trim();
    const cleanPlate = vehicleNumber.trim().toUpperCase();

    if (!cleanName) {
      setErrorMessage('Please enter your full name.');
      setErrorStatus(400);
      return;
    }

    if (!cleanPlate) {
      setErrorMessage('Please enter your vehicle registration plate number.');
      setErrorStatus(400);
      return;
    }

    if (!supportedTypes.includes(vehicleType)) {
      setErrorMessage(`Selected slot does not support ${vehicleType}. Supported: ${supportedTypes.join(', ')}`);
      setErrorStatus(400);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setErrorStatus(null);

    try {
      const created = await createReservation({
        slotId: slot.slotId,
        customerName: cleanName,
        vehicleNumber: cleanPlate,
        vehicleType,
      });

      // Reset form fields
      setCustomerName('');
      setVehicleNumber('');
      onSuccess(created);
    } catch (err) {
      setErrorStatus(err.status || 500);
      if (err.status === 409) {
        setErrorMessage(
          err.message || 'This parking slot is no longer available. Please choose another bay.'
        );
      } else if (err.status === 400) {
        setErrorMessage(err.message || 'Invalid reservation request. Please review your details.');
      } else if (err.status === 404) {
        setErrorMessage('This parking slot could not be found.');
      } else {
        setErrorMessage(err.message || 'Server error occurred while making your reservation. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="reservation-modal-backdrop" onClick={!isSubmitting ? onClose : undefined}>
      <div
        className="reservation-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-modal-title"
      >
        {/* Modal Header */}
        <div className="res-modal-header">
          <div className="res-modal-title-wrap">
            <div className="res-modal-icon-badge">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 id="reservation-modal-title" className="res-modal-title">
                Reserve Parking Bay
              </h3>
              <p className="res-modal-subtitle">
                Guaranteed parking held for 30 minutes upon confirmation
              </p>
            </div>
          </div>
          <button
            type="button"
            className="res-modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close reservation modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Slot Summary Pill Box */}
        <div className="res-slot-summary-box">
          <div className="res-slot-summary-main">
            <span className="res-slot-summary-id">{slot.slotId}</span>
            <span className={`rec-floor-badge floor-${slot.floor}`}>
              Floor {slot.floor}
            </span>
            {slot.accessible && (
              <span className="rec-feature-tag accessible-tag">
                <Accessibility size={12} />
                <span>Priority Accessible</span>
              </span>
            )}
          </div>
          <div className="res-slot-summary-meta">
            <span>
              <MapPin size={13} /> {slot.aisle || 'Designated Bay'}
            </span>
            <span>
              <Clock size={13} /> 30 Min Hold Window
            </span>
          </div>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className={`res-modal-alert ${errorStatus === 409 ? 'alert-conflict' : 'alert-error'}`}>
            <AlertCircle size={16} className="res-alert-icon" />
            <div className="res-alert-content">
              <strong>{errorStatus === 409 ? 'Slot Unavailable' : 'Booking Error'}</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Reservation Form */}
        <form onSubmit={handleSubmit} className="res-modal-form" noValidate>
          {/* Customer Name */}
          <div className="res-form-group">
            <label htmlFor="customer-name" className="res-form-label">
              Full Name <span className="req-star">*</span>
            </label>
            <input
              id="customer-name"
              type="text"
              className="res-form-input"
              placeholder="e.g. Rahul Sharma"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              maxLength={60}
              required
            />
          </div>

          {/* Vehicle Registration Plate */}
          <div className="res-form-group">
            <label htmlFor="vehicle-plate" className="res-form-label">
              Vehicle Registration Number <span className="req-star">*</span>
            </label>
            <input
              id="vehicle-plate"
              type="text"
              className="res-form-input uppercase-input"
              placeholder="e.g. DL 01 AB 1234"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              disabled={isSubmitting}
              maxLength={20}
              required
            />
            <span className="res-form-hint">Used for gate verification and barrier clearance</span>
          </div>

          {/* Vehicle Type Choice */}
          <div className="res-form-group">
            <label className="res-form-label">
              Vehicle Category <span className="req-star">*</span>
            </label>
            <div className="res-vehicle-toggle-grid">
              <button
                type="button"
                className={`res-vehicle-btn ${vehicleType === 'car' ? 'active' : ''}`}
                onClick={() => setVehicleType('car')}
                disabled={isSubmitting || !supportedTypes.includes('car')}
                title={!supportedTypes.includes('car') ? 'Not supported by this bay' : ''}
              >
                <Car size={18} />
                <span>Four-Wheeler (Car)</span>
              </button>

              <button
                type="button"
                className={`res-vehicle-btn ${vehicleType === 'bike' ? 'active' : ''}`}
                onClick={() => setVehicleType('bike')}
                disabled={isSubmitting || !supportedTypes.includes('bike')}
                title={!supportedTypes.includes('bike') ? 'Not supported by this bay' : ''}
              >
                <Bike size={18} />
                <span>Two-Wheeler (Bike)</span>
              </button>
            </div>
          </div>

          {/* Policy Notice */}
          <div className="res-policy-notice">
            <CheckCircle2 size={14} className="notice-icon" />
            <span>
              Your reservation is automatically held for <strong>30 minutes</strong>. If not occupied by then, the slot will be released back to other mall visitors.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="res-modal-actions">
            <button
              type="button"
              className="res-btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="res-btn-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Reserving Bay…</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Confirm & Reserve Slot</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
