import express from 'express';
import {
    createNewOrder,
    getOrderDetails,
    getUserOrders,
    confirmOrderDelivery,
    raiseOrderDispute,
    markOrderAsShipped
} from '../controllers/orderController';
import { authenticateToken, authorizeRole } from '../middleware/authMiddleware'; // Import authorizeRole

const router = express.Router();

// Apply authentication middleware to all order routes
router.use(authenticateToken);

// --- Order Routes --- 

// POST /api/orders/create - Create a new order (Buyer only)
// Apply authorizeRole middleware for 'buyer'
router.post('/create', authorizeRole(['buyer']), createNewOrder);

// GET /api/orders - Get orders for the authenticated user (Buyer or Seller)
// Authorization handled within the controller based on user role
router.get('/', getUserOrders);

// GET /api/orders/:id - Get details for a specific order (Buyer, Seller, or Admin)
// Authorization handled within the controller based on user relation to order
router.get('/:id', getOrderDetails);

// POST /api/orders/:id/ship - Mark order as shipped (Seller or Business only)
// Apply authorizeRole middleware for 'seller' and 'business'
router.post('/:id/ship', authorizeRole(['seller', 'business']), markOrderAsShipped);

// POST /api/orders/:id/confirm-delivery - Confirm order delivery (Buyer only)
// Apply authorizeRole middleware for 'buyer'
router.post('/:id/confirm-delivery', authorizeRole(['buyer']), confirmOrderDelivery);

// POST /api/orders/:id/raise-dispute - Raise a dispute (Buyer or Seller)
// Authorization handled within the controller based on user relation to order
router.post('/:id/raise-dispute', raiseOrderDispute);

// TODO: Add routes for admin actions on orders (e.g., force release/refund)

export default router;
