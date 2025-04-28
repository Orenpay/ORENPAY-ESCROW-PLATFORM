// server/middleware/webhookMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { mpesaConfig, airtelConfig, equityConfig } from '../../config/providers'; // Assuming secrets/keys are here

/**
 * Middleware to validate incoming M-Pesa webhooks.
 * M-Pesa validation often relies on IP whitelisting and potentially custom logic.
 * Standard signature headers might not be used for all callback types (e.g., STK Push).
 */
export const validateMpesaWebhook = (req: Request, res: Response, next: NextFunction) => {
    console.warn('TODO: Implement robust M-Pesa webhook validation.');

    // 1. IP Whitelisting (Primary Method for many M-Pesa APIs)
    // Obtain the official list of M-Pesa callback IP addresses for the specific API and environment (Sandbox/Production).
    const allowedMpesaIps = [
        // --- Sandbox IPs (Example - GET ACTUAL IPs FROM SAFARICOM) ---
        '196.201.214.200', '196.201.214.206', '196.201.213.114', '196.201.214.207',
        '196.201.214.208', '196.201.213.44',
        // --- Production IPs (Example - GET ACTUAL IPs FROM SAFARICOM) ---
        // 'x.x.x.x', 'y.y.y.y',
        // --- Localhost for testing ---
        '127.0.0.1', '::1', // Add IPv6 localhost if needed
    ];
    const requestIp = req.ip || req.connection?.remoteAddress;

    // Note: Ensure your server/proxy setup correctly forwards the original client IP (e.g., using X-Forwarded-For header if behind a proxy).
    // const sourceIp = req.headers['x-forwarded-for'] || requestIp;

    // if (!requestIp || !allowedMpesaIps.some(ip => requestIp.includes(ip))) { // Use .some() for flexibility (e.g., IPv6)
    //     console.error(`Blocked M-Pesa webhook from untrusted IP: ${requestIp}`);
    //     return res.status(403).json({ message: 'Forbidden: Invalid source IP' });
    // }

    // 2. Other Potential Checks (Less common for M-Pesa callbacks, but check specific API docs)
    // - Check for specific headers or tokens if required by the API.
    // - For APIs like B2C/Reversal, ensure the request body structure is as expected.

    console.log(`M-Pesa webhook request received from IP: ${requestIp}. Proceeding (validation pending implementation).`);
    next();
};

/**
 * Middleware to validate incoming webhooks from Airtel Money.
 * TODO: Implement actual validation based on Airtel's documentation.
 */
export const validateAirtelWebhook = (req: Request, res: Response, next: NextFunction): void => {
    console.warn('TODO: Implement Airtel Money webhook validation.');

    // Possible Validation Methods (Check Airtel Docs):
    // 1. IP Whitelisting:
    //    - Obtain and check against Airtel's official callback IP addresses.
    //    const allowedAirtelIps = [/* ... Airtel IPs ... */, '127.0.0.1', '::1'];
    //    const requestIp = req.ip || req.connection?.remoteAddress;
    //    // const sourceIp = req.headers['x-forwarded-for'] || requestIp;
    //    // if (!requestIp || !allowedAirtelIps.some(ip => requestIp.includes(ip))) {
    //    //     console.error(`Blocked Airtel webhook from untrusted IP: ${requestIp}`);
    //    //     return res.status(403).json({ message: 'Forbidden: Invalid source IP' });
    //    // }

    // 2. Signature Verification (HMAC or other):
    //    - Airtel might provide a signature in a header (e.g., 'X-Airtel-Signature').
    //    - You would need a shared secret key provided by Airtel.
    //    - Requires access to the raw request body.
    //    const providedSignature = req.headers['x-airtel-signature'] as string;
    //    const rawBody = (req as any).rawBody; // Assuming rawBody middleware is used
    //    const sharedSecret = airtelConfig.webhookSecret; // Get from config
    //    // if (!providedSignature || !rawBody || !sharedSecret) {
    //    //     console.error('Airtel webhook validation failed: Missing signature, body, or secret.');
    //    //     return res.status(400).send('Missing validation components.');
    //    // }
    //    // const calculatedSignature = crypto.createHmac('sha256', sharedSecret).update(rawBody).digest('hex');
    //    // const isValid = crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(calculatedSignature));
    //    // if (!isValid) {
    //    //     console.error('Airtel webhook validation failed: Invalid signature.');
    //    //     return res.status(403).send('Invalid webhook signature.');
    //    // }

    // 3. Basic Auth or Token:
    //    - Airtel might require specific Authorization headers.

    console.log('Airtel webhook request received. Proceeding (validation pending implementation).');
    next();
};

/**
 * Middleware to validate incoming webhooks from Equity Bank.
 * TODO: Implement actual validation based on Equity's documentation.
 */
export const validateEquityWebhook = (req: Request, res: Response, next: NextFunction): void => {
    console.warn('TODO: Implement Equity Bank webhook validation.');

    // Possible Validation Methods (Check Equity Eazzy API Docs):
    // 1. IP Whitelisting:
    //    - Obtain and check against Equity's official callback IP addresses.
    //    const allowedEquityIps = [/* ... Equity IPs ... */, '127.0.0.1', '::1'];
    //    const requestIp = req.ip || req.connection?.remoteAddress;
    //    // const sourceIp = req.headers['x-forwarded-for'] || requestIp;
    //    // if (!requestIp || !allowedEquityIps.some(ip => requestIp.includes(ip))) {
    //    //     console.error(`Blocked Equity webhook from untrusted IP: ${requestIp}`);
    //    //     return res.status(403).json({ message: 'Forbidden: Invalid source IP' });
    //    // }

    // 2. Signature Verification (JWT, HMAC, etc.):
    //    - Equity might use JWT tokens or HMAC signatures in headers.
    //    - Requires access to the raw request body for HMAC.
    //    - Requires public keys or shared secrets from Equity.
    //    const providedSignature = req.headers['x-equity-signature'] as string; // Example header
    //    const rawBody = (req as any).rawBody;
    //    const sharedSecret = equityConfig.webhookSecret; // Get from config
    //    // ... implement verification logic based on Equity's method ...
    //    // if (!isValid) {
    //    //     console.error('Equity webhook validation failed: Invalid signature.');
    //    //     return res.status(403).send('Invalid webhook signature.');
    //    // }

    // 3. Mutual TLS (mTLS):
    //    - Less common for simple webhooks, but possible. Requires server configuration.

    console.log('Equity webhook request received. Proceeding (validation pending implementation).');
    next();
};

// Note: For signature verification requiring the raw request body, you need middleware
//       in your main server setup (e.g., server.ts or equivalent) that preserves it.
// Example using Express built-in middleware:
// app.use(express.json({ verify: (req, res, buf) => { (req as any).rawBody = buf; } }));
// app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { (req as any).rawBody = buf; } }));
