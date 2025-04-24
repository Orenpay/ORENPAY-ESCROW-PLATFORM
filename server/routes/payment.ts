import express from 'express';
import {
    initiatePayment,
    mpesaCallbackHandler,
    mpesaTimeoutHandler,
    airtelCallbackHandler,
    equityCallbackHandler,
    mpesaB2CResultHandler, // Import B2C handler
    mpesaB2CTimeoutHandler // Import B2C handler
} from '../controllers/paymentController';
import { authenticateToken } from '../middleware/authMiddleware';
// Import webhook validation middleware
import {
    validateMpesaWebhook,
    validateAirtelWebhook,
    validateEquityWebhook
} from '../middleware/webhookMiddleware';

const router = express.Router();

// --- Payment Initiation Route ---
// This route allows a logged-in user (buyer) to attempt payment for an existing order
router.post('/initiate', authenticateToken, initiatePayment);

// --- Payment Callback/Webhook Routes --- 
// These routes are typically hit by the payment providers, not users directly.
// They should have webhook validation.

// M-Pesa STK Push Callbacks
router.post('/mpesa/callback/:orderId', validateMpesaWebhook, mpesaCallbackHandler); // Callback URL from Daraja
router.post('/mpesa/timeout/:orderId', validateMpesaWebhook, mpesaTimeoutHandler); // Timeout URL from Daraja

// M-Pesa B2C Callbacks (Payouts)
// Note: Ensure these paths match exactly what's configured in the M-Pesa portal for B2C Result/Timeout URLs
router.post('/mpesa/b2c/result', validateMpesaWebhook, mpesaB2CResultHandler); 
router.post('/mpesa/b2c/timeout', validateMpesaWebhook, mpesaB2CTimeoutHandler);

// Airtel Callback
router.post('/airtel/callback', validateAirtelWebhook, airtelCallbackHandler); // Define your callback URL in Airtel Dev Portal

// Equity Callback
router.post('/equity/callback', validateEquityWebhook, equityCallbackHandler); // Define your callback URL in Equity Dev Portal

export default router;
