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
    // Reversal URLs & Credentials
    reversalSecurityCredential: process.env.MPESA_REVERSAL_SECURITY_CREDENTIAL || '',
    reversalResultURL: process.env.MPESA_REVERSAL_RESULT_URL || 'https://your-app-domain.com/api/payments/mpesa/reversal/result',
    reversalTimeoutURL: process.env.MPESA_REVERSAL_TIMEOUT_URL || 'https://your-app-domain.com/api/payments/mpesa/reversal/timeout',
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

// --- Pesapal API Credentials ---
export const pesapalConfig = {
    consumerKey: process.env.PESAPAL_CONSUMER_KEY || '',
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || '',
    callbackUrl: process.env.PESAPAL_CALLBACK_URL || 'https://your-app-domain.com/api/payments/pesapal/callback',
    ipnNotificationUrl: process.env.PESAPAL_IPN_URL || 'https://your-app-domain.com/api/payments/pesapal/ipn',
    environment: process.env.PESAPAL_ENVIRONMENT || 'sandbox', // 'sandbox' or 'live'
};

// --- Telkom T-Kash API Credentials ---
export const tkashConfig = {
    apiKey: process.env.TKASH_API_KEY || '',
    apiSecret: process.env.TKASH_API_SECRET || '',
    merchantCode: process.env.TKASH_MERCHANT_CODE || '',
    callbackUrl: process.env.TKASH_CALLBACK_URL || 'https://your-app-domain.com/api/payments/tkash/callback',
    environment: process.env.TKASH_ENVIRONMENT || 'sandbox',
};

// --- iPay Kenya API Credentials ---
export const ipayConfig = {
    vendorId: process.env.IPAY_VENDOR_ID || '',
    hashKey: process.env.IPAY_HASH_KEY || '',
    callbackUrl: process.env.IPAY_CALLBACK_URL || 'https://your-app-domain.com/api/payments/ipay/callback',
    ipnUrl: process.env.IPAY_IPN_URL || 'https://your-app-domain.com/api/payments/ipay/ipn',
    environment: process.env.IPAY_ENVIRONMENT || 'sandbox', // 'sandbox' or 'live'
};

// --- DPO Group API Credentials ---
export const dpoConfig = {
    companyToken: process.env.DPO_COMPANY_TOKEN || '',
    serviceType: process.env.DPO_SERVICE_TYPE || '', // Specific service ID from DPO
    redirectUrl: process.env.DPO_REDIRECT_URL || 'https://your-app-domain.com/api/payments/dpo/callback',
    backUrl: process.env.DPO_BACK_URL || 'https://your-app-domain.com/orders/create', // Where user goes if they cancel
    ptlUrl: process.env.DPO_PTL_URL || 'https://your-app-domain.com/api/payments/dpo/ptl', // Payment Transaction Listener (Webhook)
    environment: process.env.DPO_ENVIRONMENT || 'sandbox', // 'sandbox' or 'secure' (live)
};

// --- JamboPay API Credentials ---
export const jambopayConfig = {
    clientId: process.env.JAMBOPAY_CLIENT_ID || '',
    clientSecret: process.env.JAMBOPAY_CLIENT_SECRET || '',
    apiKey: process.env.JAMBOPAY_API_KEY || '', // May vary depending on API version
    callbackUrl: process.env.JAMBOPAY_CALLBACK_URL || 'https://your-app-domain.com/api/payments/jambopay/callback',
    ipnUrl: process.env.JAMBOPAY_IPN_URL || 'https://your-app-domain.com/api/payments/jambopay/ipn',
    environment: process.env.JAMBOPAY_ENVIRONMENT || 'sandbox',
};

// --- Africa's Talking SMS Credentials ---
export const africastalkingConfig = {
    apiKey: process.env.AFRICASTALKING_API_KEY || '',
    username: process.env.AFRICASTALKING_USERNAME || 'sandbox', // 'sandbox' is often the default username for testing
    shortcodeOrSenderId: process.env.AFRICASTALKING_SENDER_ID || '', // Optional: Your registered shortcode or alphanumeric sender ID
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
    if (!pesapalConfig.consumerKey || !pesapalConfig.consumerSecret) {
        console.warn('WARNING: Production environment detected, but Pesapal credentials seem missing in .env');
    }
    if (!tkashConfig.apiKey || !tkashConfig.apiSecret) {
        console.warn('WARNING: Production environment detected, but T-Kash credentials seem missing in .env');
    }
    if (!ipayConfig.vendorId || !ipayConfig.hashKey) {
        console.warn('WARNING: Production environment detected, but iPay credentials seem missing in .env');
    }
    if (!dpoConfig.companyToken || !dpoConfig.serviceType) {
        console.warn('WARNING: Production environment detected, but DPO Group credentials seem missing in .env');
    }
    if (!jambopayConfig.clientId || !jambopayConfig.clientSecret) {
        console.warn('WARNING: Production environment detected, but JamboPay credentials seem missing in .env');
    }
    if (!africastalkingConfig.apiKey || !africastalkingConfig.username || africastalkingConfig.username === 'sandbox') {
        // Warn if using sandbox username in production or if API key is missing
        console.warn("WARNING: Production environment detected, but Africa's Talking credentials seem missing or are set to sandbox defaults in .env");
    }
    if (!paymentSettings.webhookSecret || paymentSettings.webhookSecret === 'a-very-strong-secret-for-webhook-validation') {
         console.warn('WARNING: Production environment detected, but PAYMENT_WEBHOOK_SECRET is missing or using default value in .env');
    }
}
