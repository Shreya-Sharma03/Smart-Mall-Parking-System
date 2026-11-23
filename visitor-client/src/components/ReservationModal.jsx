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
      setErrorMessage('Please enter your vehicle license plate number.');
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

      // Clear local fields and trigger parent callback
      setCustomerName('');
      setVehicleNumber('');
      onSuccess(created);
    } catch (err) {
      setErrorStatus(err.status || 500);
      if (err.status === 409) {
        setErrorMessage('This parking slot was just reserved by another visitor. Please select a different slot.');
      } else if (err.status === 400) {
        setErrorMessage(err.message || 'Validation failed. Please verify vehicle details.');
      } else {
        setErrorMessage(err.message || 'Unable to complete reservation. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !isSubmitting && onClose()}>
      <div className="reservation-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-icon">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 id="modal-title" className="modal-title">Reserve Parking Bay</h3>
            <span className="modal-subtitle">Holds your selected space for 30 minutes</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close reservation modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Slot Quick Identity Banner */}
        <div className="modal-slot-banner">
          <div className="slot-banner-identity">
            <span className="banner-slot-id">Bay {slot.slotId}</span>
            <span className="banner-floor-badge">
              <MapPin size={12} />
              <span>Floor {slot.floor}</span>
            </span>
            {slot.accessible && (
              <span className="banner-acc-badge">
                <Accessibility size={12} />
                <span>Accessible Priority</span>
              </span>
            )}
          </div>
          <div className="slot-banner-duration">
            <Clock size={13} />
            <span>30-Min Hold</span>
          </div>
        </div>

        {/* Error notification banner if any */}
        {errorMessage && (
          <div className="modal-error-banner" role="alert">
            <AlertCircle size={16} />
            <div>
              <strong>Reservation Error:</strong> {errorMessage}
            </div>
          </div>
        )}

        {/* Reservation Form */}
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="customerName" className="form-label">
              Full Name <span className="required">*</span>
            </label>
            <input
              id="customerName"
              type="text"
              className="form-input"
              placeholder="e.g. John Doe"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              maxLength={60}
            />
          </div>

          <div className="form-group">
            <label htmlFor="vehicleNumber" className="form-label">
              Vehicle Registration / Plate Number <span className="required">*</span>
            </label>
            <input
              id="vehicleNumber"
              type="text"
              className="form-input plate-input"
              placeholder="e.g. MH-12-AB-1234"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              disabled={isSubmitting}
              maxLength={15}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Vehicle Type</label>
            <div className="modal-vehicle-options">
              {supportedTypes.includes('car') && (
                <button
                  type="button"
                  className={`modal-veh-btn ${vehicleType === 'car' ? 'selected' : ''}`}
                  onClick={() => setVehicleType('car')}
                  disabled={isSubmitting}
                >
                  <Car size={16} />
                  <span>Four-Wheeler (Car)</span>
                </button>
              )}
              {supportedTypes.includes('bike') && (
                <button
                  type="button"
                  className={`modal-veh-btn ${vehicleType === 'bike' ? 'selected' : ''}`}
                  onClick={() => setVehicleType('bike')}
                  disabled={isSubmitting}
                >
                  <Bike size={16} />
                  <span>Two-Wheeler (Bike)</span>
                </button>
              )}
            </div>
          </div>

          {/* Policy Notice */}
          <div className="reservation-policy-notice">
            <CheckCircle2 size={14} className="notice-icon" />
            <p>
              Your reservation is valid for <strong>30 minutes</strong> from confirmation. If not occupied,
              the bay will automatically return to available status.
            </p>
          </div>

          {/* Form Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-cancel-modal"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm-reservation"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Confirming…</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Confirm Reservation</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
