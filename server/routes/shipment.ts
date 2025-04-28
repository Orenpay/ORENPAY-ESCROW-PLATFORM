import express from 'express';
import {
    createNewShipment,
    getShipmentDetails,
    trackShipmentByCode,
    addShipmentLeg,
    assignAgentToShipmentLeg,
    updateLegStatus
} from '../controllers/shipmentController';
import { authenticateToken, authorizeRole } from '../middleware/authMiddleware';

const router = express.Router();

// --- Public Tracking Route ---
// GET /api/shipments/track/:trackingCode - Track shipment by code
router.get('/track/:trackingCode', trackShipmentByCode);

// --- Authenticated Routes ---
router.use(authenticateToken);

// GET /api/shipments/:id - Get shipment details (Buyer, Seller, Admin)
router.get('/:id', getShipmentDetails);

// --- Agent Specific Routes ---
// PUT /api/shipments/legs/:legId/status - Update status of a shipment leg (Agent only)
// Role check happens inside controller based on leg assignment
router.put('/legs/:legId/status', updateLegStatus);

// --- Admin/System Routes ---
// POST /api/shipments/create - Create a new shipment (Admin/System)
router.post('/create', authorizeRole(['admin', 'system']), createNewShipment); // Assuming a 'system' role for internal services

// POST /api/shipments/:shipmentId/legs - Add a leg to a shipment (Admin/System)
router.post('/:shipmentId/legs', authorizeRole(['admin', 'system']), addShipmentLeg);

// POST /api/shipments/legs/:legId/assign - Assign an agent to a leg (Admin/System)
router.post('/legs/:legId/assign', authorizeRole(['admin', 'system']), assignAgentToShipmentLeg);


export default router;
