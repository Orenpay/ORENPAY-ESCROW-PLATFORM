// server/middleware/webhookMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { mpesaConfig, airtelConfig, equityConfig } from '../../config/providers'; // Assuming secrets/keys are here

/**
 * Placeholder Middleware to validate incoming M-Pesa webhooks.
 * M-Pesa validation might rely more on IP whitelisting or custom logic
 * as standard signature headers might not be used for STK callbacks.
 */
export const validateMpesaWebhook = (req: Request, res: Response, next: NextFunction) => {
    console.warn('TODO: Implement M-Pesa webhook validation (e.g., IP check).');
    // Example IP Check (replace with actual M-Pesa IPs)
    const allowedIps = ['196.201.214.200', '196.201.214.206', '196.201.213.114', '196.201.214.207', '196.201.214.208', '196.201.213.44', '127.0.0.1']; // Add localhost for testing
    const requestIp = req.ip || req.connection.remoteAddress;

    // if (!requestIp || !allowedIps.includes(requestIp)) {
    //     console.warn(`Blocked M-Pesa webhook from untrusted IP: ${requestIp}`);
    //     return res.status(403).json({ message: 'Forbidden: Invalid source IP' });
    // }

    // If validation passes
    next();
};

/**
 * Placeholder Middleware to validate incoming Airtel Money webhooks.
 * Check Airtel documentation for their specific validation method (e.g., signature header).
 */
export const validateAirtelWebhook = (req: Request, res: Response, next: NextFunction) => {
    console.warn('TODO: Implement Airtel Money webhook validation (e.g., signature check).');
    // Example Signature Check (adjust header name and logic based on Airtel docs)
    // const signature = req.headers['x-airtel-signature'] as string;
    // const secret = airtelConfig.webhookSecret; // Assuming a secret is configured
    // if (!signature || !secret) {
    //     console.warn('Airtel webhook missing signature or secret not configured.');
    //     return res.status(401).json({ message: 'Unauthorized: Missing signature' });
    // }
    // const isValid = verifySignature(req.rawBody, signature, secret); // Requires rawBody middleware
    // if (!isValid) {
    //     console.warn('Invalid Airtel webhook signature.');
    //     return res.status(403).json({ message: 'Forbidden: Invalid signature' });
    // }

    // If validation passes
    next();
};

/**
 * Placeholder Middleware to validate incoming Equity Bank webhooks.
 * Check Equity documentation for their specific validation method (e.g., HMAC signature).
 */
export const validateEquityWebhook = (req: Request, res: Response, next: NextFunction) => {
    console.warn('TODO: Implement Equity Bank webhook validation (e.g., HMAC signature).');
    // Example HMAC Check (adjust header name and logic based on Equity docs)
    // const signature = req.headers['x-equity-signature'] as string; // Example header
    // const secret = equityConfig.webhookSecret; // Assuming a secret is configured
    // if (!signature || !secret || !req.rawBody) { // Requires rawBody middleware
    //     console.warn('Equity webhook missing signature/secret or raw body not available.');
    //     return res.status(401).json({ message: 'Unauthorized: Missing signature or config' });
    // }
    // const expectedSignature = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    // const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    // if (!isValid) {
    //     console.warn('Invalid Equity webhook signature.');
    //     return res.status(403).json({ message: 'Forbidden: Invalid signature' });
    // }

    // If validation passes
    next();
};

// Helper for signature verification (example)
// const verifySignature = (rawBody: Buffer, signature: string, secret: string): boolean => {
//     // Implementation depends on the specific signature scheme (e.g., HMAC-SHA256)
//     return true; // Placeholder
// };
