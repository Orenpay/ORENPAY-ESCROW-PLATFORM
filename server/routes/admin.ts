// server/routes/admin.ts
import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/authMiddleware';
import {
    getDisputedOrders,
    resolveDisputeReleaseFunds,
    resolveDisputeRefundBuyer
} from '../controllers/adminController';

const router = express.Router();

// Apply authentication and admin role authorization to all routes in this file
router.use(authenticateToken);
router.use(authorizeRole(['admin']));

// Routes
router.get('/disputes', getDisputedOrders);
router.post('/orders/:id/resolve/release', resolveDisputeReleaseFunds);
router.post('/orders/:id/resolve/refund', resolveDisputeRefundBuyer);

export default router;
