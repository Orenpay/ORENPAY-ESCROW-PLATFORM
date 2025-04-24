// server/services/airtel.ts
import axios from 'axios';
import { airtelConfig } from '../../config/providers';
import { Order } from '../models/Order';
import { User } from '../models/User';

// TODO: Replace with actual Airtel API endpoints
const AIRTEL_API_BASE_URL = airtelConfig.environment === 'production'
    ? 'https://openapi.airtel.africa' // Example production URL
    : 'https://openapiuat.airtel.africa'; // Example sandbox URL

/**
 * Gets Airtel Money API access token.
 */
const getAccessToken = async (): Promise<string | null> => {
    const url = `${AIRTEL_API_BASE_URL}/auth/oauth2/token`;
    const payload = {
        client_id: airtelConfig.clientId,
        client_secret: airtelConfig.clientSecret,
        grant_type: 'client_credentials',
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        return response.data.access_token;
    } catch (error: any) {
        console.error('Error getting Airtel access token:', error.response?.data || error.message);
        return null;
    }
};

/**
 * Initiates an Airtel Money payment request.
 * (This is a generic structure, specific API details will vary)
 */
export const initiateAirtelPayment = async (order: Order, buyer: User): Promise<any> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        throw new Error('Failed to get Airtel access token');
    }

    // TODO: Adjust endpoint and payload based on Airtel's specific API for collections/disbursements
    const url = `${AIRTEL_API_BASE_URL}/standard/v1/payments/`; // Example endpoint

    // Ensure phone number format is correct for Airtel (may differ from M-Pesa)
    const phoneNumber = buyer.phone_number; // Adjust formatting as needed

    if (!phoneNumber) {
        throw new Error('Buyer phone number is missing or invalid for Airtel payment.');
    }

    const transactionRef = `ORENPAY-AIRTEL-${order.id}-${Date.now()}`;

    const payload = {
        // Structure depends heavily on the specific Airtel API product being used
        // Example structure (likely incorrect, needs API docs):
        reference: transactionRef,
        subscriber: {
            country: 'KE', // Kenya
            currency: 'KES', // Kenyan Shilling
            msisdn: phoneNumber.replace(/^\+?254/, ''), // Airtel might need local format
        },
        transaction: {
            amount: order.amount,
            country: 'KE',
            currency: 'KES',
            id: transactionRef,
        },
        // May need callback URL, PIN prompt details etc.
    };

    try {
        console.log('Initiating Airtel payment with payload:', payload);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // May need other headers like X-Country, X-Currency
            },
        });
        console.log('Airtel payment initiated successfully:', response.data);
        // TODO: Store transaction reference for reconciliation
        return response.data;
    } catch (error: any) {
        console.error('Error initiating Airtel payment:', error.response?.data || error.message);
        throw new Error(`Failed to initiate Airtel payment: ${error.response?.data?.description || error.message}`);
    }
};

/**
 * Handles the callback from Airtel Money.
 */
export const handleAirtelCallback = async (callbackData: any): Promise<void> => {
    console.log('Received Airtel callback:', JSON.stringify(callbackData));

    // TODO: Validate the callback source (e.g., signature, IP address)

    // TODO: Parse callbackData to determine success/failure, order ID, transaction ref
    const transactionId = callbackData?.transaction?.id; // Example path
    const status = callbackData?.transaction?.status; // Example path
    const orderId = extractOrderIdFromRef(transactionId); // Need a helper function

    if (!orderId) {
        console.error('Could not extract Order ID from Airtel callback reference.');
        return;
    }

    let transactionStatus: 'success' | 'failed' = 'failed';
    let description = 'Payment status unknown';

    // TODO: Map Airtel status codes/messages to our internal statuses
    if (status === 'SUCCESS' || status === 'TS') { // Example success codes
        transactionStatus = 'success';
        description = 'Payment successful';
        // TODO: Update order status to 'paid'
        // await updateOrderStatus(orderId, 'paid');
    } else {
        transactionStatus = 'failed';
        description = `Payment failed: ${status || 'Unknown reason'}`;
        // TODO: Optionally update order status
    }

    // TODO: Log the transaction
    // await createTransaction({
    //     order_id: orderId,
    //     user_id: /* Need user ID */,
    //     provider: 'airtel',
    //     provider_ref: transactionId,
    //     amount: /* Need amount */,
    //     status: transactionStatus,
    //     description: description,
    // });
    console.log(`Transaction log updated for Order ${orderId} (Airtel). Status: ${transactionStatus}`);
};

// Helper function (example)
const extractOrderIdFromRef = (ref: string): number | null => {
    if (!ref) return null;
    const match = ref.match(/ORENPAY-AIRTEL-(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
};
