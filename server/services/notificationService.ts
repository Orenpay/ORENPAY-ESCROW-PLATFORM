// server/services/notificationService.ts
import AfricasTalking from 'africastalking';
import { africastalkingConfig } from '../../config/providers';
import { findUserById } from '../models/User'; // To fetch phone numbers
import nodemailer from 'nodemailer';

if (!africastalkingConfig.apiKey || !africastalkingConfig.username || africastalkingConfig.username === 'sandbox') {
    console.warn("Africa's Talking API Key or Username is not configured correctly (or using sandbox). SMS notifications may be disabled or use sandbox.");
}

const credentials = {
    apiKey: africastalkingConfig.apiKey!,
    username: africastalkingConfig.username!,
};

// Initialize Africa's Talking SDK
let sms: any;
if (credentials.apiKey && credentials.username) {
    const africasTalking = AfricasTalking(credentials);
    sms = africasTalking.SMS;
} else {
    // Mock SMS function if not configured
    sms = {
        send: async (options: any) => {
            console.log('--- SMS Notification (Mock) ---');
            console.log(`To: ${options.to.join(', ')}`);
            console.log(`Message: ${options.message}`);
            console.log('-----------------------------');
            return Promise.resolve({ /* Mock success response */ });
        }
    };
    console.log("Initialized Mock SMS service.");
}

// --- Email Sending (SendGrid SMTP recommended) ---
const smtpUser = process.env.SENDGRID_SMTP_USER;
const smtpPass = process.env.SENDGRID_SMTP_PASS;
const fromEmail = process.env.FROM_EMAIL || 'no-reply@orenpay.co.ke';

let transporter: nodemailer.Transporter | null = null;
if (smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
} else {
    console.warn('SendGrid SMTP credentials not set. Email notifications will be mocked.');
}

// --- Rate Limiting and Abuse Prevention (in-memory, for demo; use Redis for production) ---
const smsRequestLog: Record<string, { count: number; lastRequest: number }> = {};
const emailRequestLog: Record<string, { count: number; lastRequest: number }> = {};
const SMS_LIMIT = 5; // max 5 OTPs per hour per phone
const EMAIL_LIMIT = 5; // max 5 emails per hour per email
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function canSendSms(phone: string): boolean {
    const now = Date.now();
    const entry = smsRequestLog[phone] || { count: 0, lastRequest: 0 };
    if (now - entry.lastRequest > WINDOW_MS) {
        smsRequestLog[phone] = { count: 1, lastRequest: now };
        return true;
    }
    if (entry.count >= SMS_LIMIT) return false;
    smsRequestLog[phone] = { count: entry.count + 1, lastRequest: now };
    return true;
}

function canSendEmail(email: string): boolean {
    const now = Date.now();
    const entry = emailRequestLog[email] || { count: 0, lastRequest: 0 };
    if (now - entry.lastRequest > WINDOW_MS) {
        emailRequestLog[email] = { count: 1, lastRequest: now };
        return true;
    }
    if (entry.count >= EMAIL_LIMIT) return false;
    emailRequestLog[email] = { count: entry.count + 1, lastRequest: now };
    return true;
}

// --- Best Practices for Notification Sending ---
// 1. Use reliable providers (SendGrid for email, Africa's Talking for SMS)
// 2. Store API keys in environment variables, never in code
// 3. Use secure, random tokens for email links and short numeric OTPs for SMS
// 4. Set expiry for tokens/OTPs (10 min for OTP, 24h for email)
// 5. Rate limit notification requests (see in-memory demo, use Redis for production)
// 6. Log all send attempts and failures (never log full tokens/OTPs)
// 7. Show clear user feedback in the UI
// 8. Never expose tokens/OTPs in logs or errors
// 9. Use provider sandbox/test modes for development
// 10. Ensure compliance with local regulations (opt-in, privacy)
// 11. Always get user consent for notifications
// 12. Invalidate tokens/OTPs after use or expiry
// 13. Use HTTPS for all verification links
// 14. Localize messages if needed
// 15. Use a persistent store for rate limiting in production (e.g., Redis)
// --- End Best Practices ---

/**
 * Sends an SMS notification using Africa's Talking.
 * @param recipientPhone - The phone number to notify (international format).
 * @param message - The message content.
 */
export const sendSmsNotification = async (recipientPhone: string, message: string): Promise<void> => {
    if (!canSendSms(recipientPhone)) {
        console.warn(`SMS rate limit exceeded for ${recipientPhone}`);
        return;
    }
    if (!sms) {
        console.warn('SMS service not initialized. Cannot send SMS.');
        return;
    }
    try {
        let formattedPhoneNumber = recipientPhone;
        if (!formattedPhoneNumber.startsWith('+')) {
            if (formattedPhoneNumber.startsWith('254')) {
                formattedPhoneNumber = `+${formattedPhoneNumber}`;
            } else if (formattedPhoneNumber.startsWith('0')) {
                formattedPhoneNumber = `+254${formattedPhoneNumber.substring(1)}`;
            } else {
                console.warn(`Cannot format phone number: ${recipientPhone}`);
                return;
            }
        }
        const options = {
            to: [formattedPhoneNumber],
            message: message,
        };
        console.log(`[${new Date().toISOString()}] Sending SMS to ${options.to[0]}: "${options.message}"`);
        const response = await sms.send(options);
        console.log("Africa's Talking SMS Response:", response);
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error sending SMS to ${recipientPhone}:`, error.message || error);
    }
};

/**
 * Sends an SMS notification using Africa's Talking, with rate limiting and logging.
 * @param recipientPhone - The phone number to notify (international format).
 * @param message - The message content.
 */
export const sendSmsOtp = async (recipientPhone: string, message: string): Promise<void> => {
    if (!canSendSms(recipientPhone)) {
        console.warn(`SMS rate limit exceeded for ${recipientPhone}`);
        return;
    }
    if (!sms) {
        console.warn('SMS service not initialized. Cannot send SMS.');
        return;
    }
    try {
        let formattedPhoneNumber = recipientPhone;
        if (!formattedPhoneNumber.startsWith('+')) {
            if (formattedPhoneNumber.startsWith('254')) {
                formattedPhoneNumber = `+${formattedPhoneNumber}`;
            } else if (formattedPhoneNumber.startsWith('0')) {
                formattedPhoneNumber = `+254${formattedPhoneNumber.substring(1)}`;
            } else {
                console.warn(`Cannot format phone number: ${recipientPhone}`);
                return;
            }
        }
        const options = {
            to: [formattedPhoneNumber],
            message: message,
        };
        console.log(`[${new Date().toISOString()}] Sending SMS to ${options.to[0]}: "${options.message}"`);
        const response = await sms.send(options);
        console.log("Africa's Talking SMS Response:", response);
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] Error sending SMS to ${recipientPhone}:`, error.message || error);
    }
};

/**
 * Sends an email verification link to the user.
 * @param email - The user's email address.
 * @param token - The verification token.
 */
export const sendEmailVerification = async (email: string, token: string): Promise<void> => {
    if (!canSendEmail(email)) {
        console.warn(`Email rate limit exceeded for ${email}`);
        return;
    }
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email?token=${token}`;
    const subject = 'Verify your email for OrenPay';
    const html = `<p>Thank you for registering with OrenPay.</p>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verifyUrl}">${verifyUrl}</a>
        <p>This link will expire in 24 hours.</p>`;
    if (transporter) {
        try {
            await transporter.sendMail({
                from: fromEmail,
                to: email,
                subject,
                html,
            });
            console.log(`[${new Date().toISOString()}] Verification email sent to ${email}`);
        } catch (err) {
            console.error(`[${new Date().toISOString()}] Error sending verification email to ${email}:`, err);
        }
    } else {
        // Mock email for dev
        console.log('--- Email Notification (Mock) ---');
        console.log(`To: ${email}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body: ${html}`);
        console.log('-------------------------------');
    }
};

// Notes:
// - For production, use Redis or a persistent store for rate limiting.
// - Always log notification attempts for audit/compliance.
// - Never log full OTPs/tokens in production logs.
// - Ensure opt-in/consent for notifications per local law.

