import dotenv from 'dotenv';

dotenv.config();

// --- M-Pesa Daraja API Credentials ---
export const mpesaConfig = {
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
    // STK Push URLs
    stkCallbackUrlBase: process.env.MPESA_STK_CALLBACK_URL_BASE || 'https://your-app-domain.com/api/payments/mpesa/stk-callback', // Base URL for STK callbacks
    stkTimeoutUrlBase: process.env.MPESA_STK_TIMEOUT_URL_BASE || 'https://your-app-domain.com/api/payments/mpesa/stk-timeout', // Base URL for STK timeout
    // B2C URLs & Credentials
    b2cInitiatorName: process.env.MPESA_B2C_INITIATOR_NAME || '', // Your Daraja portal initiator username
    b2cInitiatorPassword: process.env.MPESA_B2C_INITIATOR_PASSWORD || '', // Your Daraja portal initiator password (will be encrypted)
    b2cSecurityCredential: process.env.MPESA_B2C_SECURITY_CREDENTIAL || '', // Generated from initiator password (see M-Pesa docs)
    b2cQueueTimeoutURL: process.env.MPESA_B2C_TIMEOUT_URL || 'https://your-app-domain.com/api/payments/mpesa/b2c-timeout',
    b2cResultURL: process.env.MPESA_B2C_RESULT_URL || 'https://your-app-domain.com/api/payments/mpesa/b2c-result',
};

// --- Airtel Money API Credentials ---
export const airtelConfig = {
    clientId: process.env.AIRTEL_CLIENT_ID || '',
    clientSecret: process.env.AIRTEL_CLIENT_SECRET || '',
    publicKey: process.env.AIRTEL_PUBLIC_KEY || '', // Often needed for encryption/signature
    environment: process.env.AIRTEL_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
    callbackUrl: process.env.AIRTEL_CALLBACK_URL || 'https://your-app-domain.com/api/payments/airtel/callback',
};

// --- Equity Bank Eazzy API Credentials ---
export const equityConfig = {
    consumerKey: process.env.EQUITY_CONSUMER_KEY || '',
    consumerSecret: process.env.EQUITY_CONSUMER_SECRET || '',
    merchantCode: process.env.EQUITY_MERCHANT_CODE || '',
    environment: process.env.EQUITY_ENVIRONMENT || 'sandbox', // 'sandbox' or 'production'
    callbackUrl: process.env.EQUITY_CALLBACK_URL || 'https://your-app-domain.com/api/payments/equity/callback',
};

// --- General Payment Settings ---
export const paymentSettings = {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'a-very-strong-secret-for-webhook-validation',
};

// --- Validation --- 
// Basic check to ensure critical env vars are loaded, especially for production
if (process.env.NODE_ENV === 'production') {
    if (!mpesaConfig.consumerKey || !mpesaConfig.consumerSecret /* || Add other critical checks */) {
        console.warn('WARNING: Production environment detected, but some payment provider credentials seem missing in .env');
    }
    if (!airtelConfig.clientId || !airtelConfig.clientSecret) {
        console.warn('WARNING: Production environment detected, but Airtel credentials seem missing in .env');
    }
    if (!equityConfig.consumerKey || !equityConfig.consumerSecret) {
        console.warn('WARNING: Production environment detected, but Equity credentials seem missing in .env');
    }
    if (!paymentSettings.webhookSecret || paymentSettings.webhookSecret === 'a-very-strong-secret-for-webhook-validation') {
         console.warn('WARNING: Production environment detected, but PAYMENT_WEBHOOK_SECRET is missing or using default value in .env');
    }
}
