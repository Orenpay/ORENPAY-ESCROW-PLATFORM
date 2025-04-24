// server/services/equity.ts
import axios from 'axios';
import { equityConfig } from '../../config/providers';
import { Order } from '../models/Order';
import { User } from '../models/User';

// TODO: Replace with actual Equity Eazzy API endpoints
const EQUITY_API_BASE_URL = equityConfig.environment === 'production'
    ? 'https://api.equitybankgroup.com' // Example production URL
    : 'https://uat.equitybankgroup.com'; // Example sandbox URL

/**
 * Gets Equity Eazzy API access token.
 */
const getAccessToken = async (): Promise<string | null> => {
    // TODO: Implement Equity's specific OAuth mechanism
    // It might involve different grant types or headers
    const url = `${EQUITY_API_BASE_URL}/oauth/token`; // Example endpoint
    const auth = Buffer.from(`${equityConfig.consumerKey}:${equityConfig.consumerSecret}`).toString('base64');

    try {
        // This is a generic OAuth request, adjust as per Equity docs
        const response = await axios.post(url, 'grant_type=client_credentials', { // Payload might differ
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        return response.data.access_token;
    } catch (error: any) {
        console.error('Error getting Equity access token:', error.response?.data || error.message);
        return null;
    }
};

/**
 * Initiates an Equity Bank payment request.
 * (Structure depends heavily on the specific Eazzy API product)
 */
export const initiateEquityPayment = async (order: Order, buyer: User): Promise<any> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        throw new Error('Failed to get Equity access token');
    }

    // TODO: Adjust endpoint and payload based on Equity's API for P2P, Bill Pay, etc.
    const url = `${EQUITY_API_BASE_URL}/v1/payments/initiate`; // Example endpoint

    const transactionRef = `ORENPAY-EQUITY-${order.id}-${Date.now()}`;

    const payload = {
        // Structure depends heavily on the specific Equity API
        // Example structure (likely incorrect, needs API docs):
        merchantCode: equityConfig.merchantCode,
        transactionReference: transactionRef,
        amount: order.amount,
        currency: 'KES',
        customer: {
            // May need account number, phone number, etc.
            identifier: buyer.phone_number || buyer.email, // Example
        },
        narration: `Payment for Order #${order.id}`,
        callbackUrl: `${equityConfig.callbackUrl}?orderId=${order.id}`, // Pass order ID in callback
        // May need specific transaction type codes
    };

    try {
        console.log('Initiating Equity payment with payload:', payload);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // May need other specific Equity headers
            },
        });
        console.log('Equity payment initiated successfully:', response.data);
        // TODO: Store transaction reference for reconciliation
        // Might involve redirecting the user to an Equity payment page
        return response.data;
    } catch (error: any) {
        console.error('Error initiating Equity payment:', error.response?.data || error.message);
        throw new Error(`Failed to initiate Equity payment: ${error.response?.data?.error_description || error.message}`);
    }
};

/**
 * Handles the callback from Equity Bank.
 */
export const handleEquityCallback = async (callbackData: any, queryParams: any): Promise<void> => {
    console.log('Received Equity callback:', JSON.stringify(callbackData), 'Query:', queryParams);

    // TODO: Validate the callback source (e.g., signature, IP address)

    // TODO: Parse callbackData and queryParams to determine success/failure, order ID, transaction ref
    const orderId = parseInt(queryParams?.orderId, 10); // Example: Get orderId from query param
    const status = callbackData?.transactionStatus; // Example path
    const transactionRef = callbackData?.transactionReference; // Example path

    if (isNaN(orderId)) {
        console.error('Could not determine Order ID from Equity callback.');
        return;
    }

    let transactionStatus: 'success' | 'failed' = 'failed';
    let description = 'Payment status unknown';

    // TODO: Map Equity status codes/messages to our internal statuses
    if (status === 'Completed' || status === 'Success') { // Example success codes
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
    //     provider: 'equity',
    //     provider_ref: transactionRef,
    //     amount: /* Need amount */,
    //     status: transactionStatus,
    //     description: description,
    // });
    console.log(`Transaction log updated for Order ${orderId} (Equity). Status: ${transactionStatus}`);
};
