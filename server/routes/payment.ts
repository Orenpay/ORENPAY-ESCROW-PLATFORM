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
import { handlePesapalCallback } from '../controllers/paymentController'; // Import Pesapal handler
import { handleTkashCallback } from '../services/tkash'; // Import T-Kash handler
import { handleIpayWebhook } from '../services/ipay'; // Import iPay handler
import { handleDpoWebhook } from '../services/dpo'; // Import DPO handler
import { handleJambopayWebhook } from '../services/jambopay'; // Import JamboPay handler

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

// Airtel Money Callbacks
// Note: Ensure this path matches exactly what's configured in the Airtel portal
router.post('/airtel/callback', validateAirtelWebhook, airtelCallbackHandler);

// Equity Bank Callbacks
// Note: Ensure this path matches exactly what's configured in the Equity portal
router.post('/equity/callback', validateEquityWebhook, equityCallbackHandler);

// Pesapal IPN
// Note: Ensure this path matches exactly what's configured in the Pesapal portal
router.get('/pesapal/callback', handlePesapalCallback); // Pesapal uses GET for IPN

export default router;
