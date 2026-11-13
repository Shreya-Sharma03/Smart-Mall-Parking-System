/**
 * Camera-to-Slot Authorization Configuration
 * 
 * Defines authorized cameras, operational status, floor mappings,
 * and bay whitelists for the Smart Mall Parking System.
 */

const CAMERA_CONFIG = {
    "CAM-B1-01": {
        floor: "B1",
        enabled: true,
        description: "Basement 1 Main Parking Concourse Camera",
        authorizedSlots: [
            "B1-A01", "B1-A02", "B1-A03", "B1-A04",
            "B1-A05", "B1-A06", "B1-A07", "B1-A08"
        ]
    },
    "CAM-B1-02": {
        floor: "B1",
        enabled: false,
        description: "Basement 1 Secondary Camera (Uncalibrated)",
        reason: "Camera CAM-B1-02 is uncalibrated and disabled",
        authorizedSlots: [
            "B1-A09", "B1-A10", "B1-A11", "B1-A12"
        ]
    },
    "CAM-B2-01": {
        floor: "B2",
        enabled: true,
        description: "Basement 2 Lower Concourse Camera",
        authorizedSlots: [
            "B2-A01", "B2-A02", "B2-A03", "B2-A04",
            "B2-A05", "B2-A06", "B2-A07", "B2-A08",
            "B2-A09", "B2-A10", "B2-A11", "B2-A12"
        ]
    }
};

/**
 * Checks whether a camera ID exists in the configuration.
 * @param {string} cameraId
 * @returns {boolean}
 */
function isCameraKnown(cameraId) {
    if (!cameraId || typeof cameraId !== "string") {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(CAMERA_CONFIG, cameraId.trim());
}

/**
 * Checks whether a camera is active and authorized to submit updates.
 * @param {string} cameraId
 * @returns {boolean}
 */
function isCameraEnabled(cameraId) {
    if (!isCameraKnown(cameraId)) {
        return false;
    }
    return CAMERA_CONFIG[cameraId.trim()].enabled === true;
}

/**
 * Retrieves the full configuration for a given camera.
 * @param {string} cameraId
 * @returns {object|null}
 */
function getCameraConfig(cameraId) {
    if (!isCameraKnown(cameraId)) {
        return null;
    }
    return CAMERA_CONFIG[cameraId.trim()];
}

/**
 * Retrieves the assigned floor for a given camera.
 * @param {string} cameraId
 * @returns {string|null}
 */
function getCameraFloor(cameraId) {
    const config = getCameraConfig(cameraId);
    return config ? config.floor : null;
}

/**
 * Retrieves the list of authorized slot IDs for a given camera.
 * @param {string} cameraId
 * @returns {string[]}
 */
function getAuthorizedSlots(cameraId) {
    const config = getCameraConfig(cameraId);
    return config ? [...config.authorizedSlots] : [];
}

/**
 * Verifies whether a specific parking slot is authorized to be updated by a camera.
 * @param {string} cameraId
 * @param {string} slotId
 * @returns {boolean}
 */
function isSlotAuthorizedForCamera(cameraId, slotId) {
    const config = getCameraConfig(cameraId);
    if (!config || !slotId || typeof slotId !== "string") {
        return false;
    }
    return config.authorizedSlots.includes(slotId.trim());
}

/**
 * Retrieves the rejection reason for a disabled camera.
 * @param {string} cameraId
 * @returns {string|null}
 */
function getDisabledReason(cameraId) {
    const config = getCameraConfig(cameraId);
    if (!config) {
        return "Unknown camera ID";
    }
    return config.reason || "Camera is disabled";
}

module.exports = {
    CAMERA_CONFIG,
    isCameraKnown,
    isCameraEnabled,
    getCameraConfig,
    getCameraFloor,
    getAuthorizedSlots,
    isSlotAuthorizedForCamera,
    getDisabledReason
};
