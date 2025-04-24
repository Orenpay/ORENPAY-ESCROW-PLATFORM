import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to validate incoming M-Pesa webhook requests.
 * In a production environment, this should verify the request originates
 * from Safaricom's IP addresses.
 * See: https://developer.safaricom.co.ke/faqs/security-credentials/what-are-the-safaricom-daraja-api-ips
 */
export const validateMpesaWebhook = (req: Request, res: Response, next: NextFunction) => {
    // TODO: Implement IP address validation against Safaricom's published ranges
    const sourceIp = req.ip || req.socket.remoteAddress;
    console.log(`Received M-Pesa callback from IP: ${sourceIp}. Validation pending implementation.`);

    // For now, allow the request to proceed
    next();
};
