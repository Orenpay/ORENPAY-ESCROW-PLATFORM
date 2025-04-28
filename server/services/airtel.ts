// server/services/airtel.ts
import axios, { AxiosResponse } from 'axios'; // Import AxiosResponse
import { airtelConfig } from '../../config/providers';
import { Order, OrderStatus, updateOrderStatus, findOrderById } from '../models/Order'; // Import OrderStatus, updateOrderStatus, findOrderById
import { User } from '../models/User';
// Import Transaction model functions
import { Transaction, TransactionStatus, findTransactionByProviderRef, updateTransactionDetails, createTransaction } from '../models/Transaction';
// Import notification service
import { sendSmsNotification } from './notificationService';
import { findUserById } from '../models/User'; // Import findUserById

// TODO: Replace with actual Airtel API endpoints
const AIRTEL_API_BASE_URL = airtelConfig.environment === 'production'
    ? 'https://openapi.airtel.africa' // Example production URL
    : 'https://openapiuat.airtel.africa'; // Example sandbox URL

// Define an interface for the expected token response
interface AirtelTokenResponse {
    access_token: string;
    // Add other potential properties like expires_in, token_type if needed
}

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
        // Explicitly type the response using the interface
        const response: AxiosResponse<AirtelTokenResponse> = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
        });
        // Now response.data is typed as AirtelTokenResponse
        return response.data.access_token;
    } catch (error: any) {
        console.error('Error getting Airtel access token:', error.response?.data || error.message);
        return null;
    }
};

/**
 * Initiates an Airtel Money payment request (Collection).
 * Requires buyer's phone number and order details.
 * NOTE: This implementation is based on a *hypothetical* Airtel API structure.
 *       Verify endpoints, payload, headers, and responses against official Airtel documentation.
 */
export const initiateAirtelPayment = async (order: Order, buyer: User): Promise<any> => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        throw new Error('Failed to get Airtel access token');
    }

    // TODO: Verify the correct Airtel API endpoint for collections/payments
    const url = `${AIRTEL_API_BASE_URL}/standard/v1/collections/`; // Example endpoint

    // Ensure phone number format is correct for Airtel (e.g., might need local format without country code)
    const rawPhoneNumber = buyer.phone_number;
    if (!rawPhoneNumber) {
        throw new Error('Buyer phone number is missing.');
    }
    // Example: Convert 2547... to 07... or 7... based on API requirement
    const formattedPhoneNumber = rawPhoneNumber.startsWith('254') ? '0' + rawPhoneNumber.substring(3) : rawPhoneNumber;
    // TODO: Confirm the exact phone number format required by the Airtel API

    const transactionRef = `ORENPAY-AIRTEL-${order.id}-${Date.now()}`;

    // TODO: Verify the exact payload structure required by the Airtel Collections API
    const payload = {
        reference: transactionRef, // Your unique reference for the transaction
        subscriber: {
            country: 'KE', // Kenya ISO code
            currency: 'KES', // Currency ISO code
            msisdn: formattedPhoneNumber, // Customer's phone number in the required format
        },
        transaction: {
            amount: order.amount,
            country: 'KE',
            currency: 'KES',
            id: transactionRef, // Often the same as the main reference
            description: `Payment for OrenPay Order #${order.id}` // Optional description
        },
        // May need additional fields like: pin_prompt: true/false, callback_url, etc.
    };

    try {
        console.log(`Initiating Airtel payment request to ${formattedPhoneNumber} for Order ${order.id}, Amount: ${order.amount}, Ref: ${transactionRef}`);
        console.log('Airtel Payload:', JSON.stringify(payload, null, 2));

        // TODO: Verify required headers (e.g., X-Country, X-Currency)
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Country': 'KE', // Example header
                'X-Currency': 'KES', // Example header
            },
        });

        console.log(`Airtel payment initiation successful for Ref: ${transactionRef}. Response:`, response.data);

        // TODO: Check the response structure and status codes from Airtel documentation
        // Example: Check for a specific success indicator
        if (response.data?.status?.code === 'SUCCESS_CODE') { // Replace 'SUCCESS_CODE'
            // Return relevant data, potentially including Airtel's transaction ID if provided immediately
            return {
                providerTransactionId: response.data?.transaction?.id, // Example path
                message: response.data?.status?.message || 'Initiation successful',
                transactionRef: transactionRef, // Your internal reference
            };
        } else {
            // Handle cases where the API accepts the request but indicates an issue
            throw new Error(`Airtel initiation failed: ${response.data?.status?.message || 'Unknown Airtel error'}`);
        }

    } catch (error: any) {
        const errorMessage = error.response?.data?.description || error.response?.data?.message || error.message;
        console.error(`Error initiating Airtel payment for Ref ${transactionRef}:`, errorMessage, error.response?.data);
        throw new Error(`Failed to initiate Airtel payment: ${errorMessage}`);
    }
};

/**
 * Handles the callback from Airtel Money.
 * Needs refinement based on actual callback structure for payments, payouts, refunds.
 */
export const handleAirtelCallback = async (callbackData: any): Promise<{ code: string; message: string }> => {
    console.log('Received Airtel callback:', JSON.stringify(callbackData, null, 2));

    // TODO: Validate the callback source (e.g., signature, IP address) - CRITICAL for security

    // --- Assume a structure like M-Pesa's for parsing ---
    // This needs verification with actual Airtel callback data
    const result = callbackData?.Result || callbackData?.transaction; // Adapt based on actual data
    const resultCode = result?.ResultCode ?? result?.status_code ?? (result?.status === 'TS' || result?.status === 'SUCCESS' ? '0' : '1'); // Example mapping
    const resultDesc = result?.ResultDesc ?? result?.message ?? result?.description ?? 'No description';
    const providerRef = result?.ThirdPartyReference // Reference from initiation (e.g., ORENPAY-AIRTEL-ORDERID-TIMESTAMP)
        ?? result?.reference // Or maybe just 'reference'
        ?? callbackData?.reference;
    const providerTransactionId = result?.TransactionID // Airtel's unique ID for the completed transaction
        ?? result?.id
        ?? callbackData?.transaction_id;

    if (!providerRef) {
        console.error('Airtel Callback Error: Could not extract a valid provider reference (ThirdPartyReference or reference).', callbackData);
        // Respond to Airtel indicating an issue processing the callback reference
        return { code: '01', message: 'Callback received but reference ID missing or invalid.' };
    }

    // --- Find the Original Transaction Log ---
    // Determine provider type based on ref prefix or callback context if possible
    let providerType = 'airtel'; // Default to collection/payment
    if (providerRef.includes('-PAYOUT-')) providerType = 'airtel_payout';
    if (providerRef.includes('-REFUND-')) providerType = 'airtel_refund';

    const transaction = await findTransactionByProviderRef(providerRef, providerType);

    if (!transaction) {
        console.error(`Airtel Callback Error: Transaction log not found for ProviderRef: ${providerRef}, ProviderType: ${providerType}`);
        // Respond to Airtel indicating the reference is unknown to us
        return { code: '01', message: 'Transaction reference not found.' };
    }

    if (transaction.status === 'success' || transaction.status === 'failed' || transaction.status === 'refunded') {
        console.warn(`Airtel Callback Warning: Transaction ${transaction.id} (Ref: ${providerRef}) already processed with status ${transaction.status}. Ignoring callback.`);
        // Acknowledge receipt to prevent retries
        return { code: '00', message: 'Callback received for already finalized transaction.' };
    }

    // --- Determine Internal Status and Order Status ---
    let internalStatus: TransactionStatus;
    let orderStatusUpdate: OrderStatus | null = null;
    let notificationMessageBuyer: string | null = null;
    let notificationMessageSeller: string | null = null;

    // TODO: Refine status mapping based on actual Airtel codes/statuses
    const isSuccess = resultCode === '0' || resultCode === 0 || result?.status === 'TS' || result?.status === 'SUCCESS'; // Example success indicators

    if (isSuccess) {
        switch (providerType) {
            case 'airtel': // Payment Success
                internalStatus = 'success';
                orderStatusUpdate = 'paid';
                notificationMessageBuyer = `Your payment of KES ${transaction.amount} for Order #${transaction.order_id} via Airtel Money was successful. Ref: ${providerTransactionId || providerRef}.`;
                notificationMessageSeller = `Payment of KES ${transaction.amount} received for Order #${transaction.order_id} via Airtel Money. Ref: ${providerTransactionId || providerRef}. Prepare for shipment.`;
                break;
            case 'airtel_payout': // Payout Success
                internalStatus = 'success';
                orderStatusUpdate = 'completed'; // Order is complete after successful payout
                notificationMessageSeller = `Funds (KES ${transaction.amount}) for Order #${transaction.order_id} have been successfully sent to your Airtel Money account. Ref: ${providerTransactionId || providerRef}.`;
                notificationMessageBuyer = `Funds for Order #${transaction.order_id} have been released to the seller.`;
                break;
            case 'airtel_refund': // Refund Success
                internalStatus = 'success'; // The refund transaction succeeded
                orderStatusUpdate = 'refunded'; // The order is now refunded
                notificationMessageBuyer = `Your refund of KES ${transaction.amount} for Order #${transaction.order_id} via Airtel Money was successful. Ref: ${providerTransactionId || providerRef}.`;
                notificationMessageSeller = `The refund for Order #${transaction.order_id} has been successfully processed to the buyer.`;
                break;
            default:
                internalStatus = 'failed'; // Should not happen
                console.error(`Airtel Callback Error: Unknown provider type '${providerType}' for successful callback.`);
        }
    } else { // Failure or Ambiguous
        switch (providerType) {
            case 'airtel': // Payment Failure
                internalStatus = 'failed';
                // No order status change usually needed for failed payment
                notificationMessageBuyer = `Your Airtel Money payment for Order #${transaction.order_id} failed. Reason: ${resultDesc}. Please try again or contact support.`;
                break;
            case 'airtel_payout': // Payout Failure
                internalStatus = 'failed';
                orderStatusUpdate = 'payout_failed'; // Mark order as payout failed
                notificationMessageSeller = `Fund release (KES ${transaction.amount}) for Order #${transaction.order_id} failed. Reason: ${resultDesc}. Please contact support.`;
                notificationMessageBuyer = `There was an issue releasing funds to the seller for Order #${transaction.order_id}. Please contact support if needed.`;
                break;
            case 'airtel_refund': // Refund Failure
                internalStatus = 'failed';
                orderStatusUpdate = 'refund_failed'; // Mark order as refund failed
                notificationMessageBuyer = `Your refund attempt (KES ${transaction.amount}) for Order #${transaction.order_id} failed. Reason: ${resultDesc}. Please contact support.`;
                notificationMessageSeller = `The refund attempt for Order #${transaction.order_id} failed. Reason: ${resultDesc}. Please contact support if needed.`;
                break;
            default:
                internalStatus = 'failed';
                console.error(`Airtel Callback Error: Unknown provider type '${providerType}' for failed callback.`);
        }
    }

    // --- Update Database ---
    try {
        await updateTransactionDetails(transaction.id!, internalStatus, {
            provider_status_code: String(resultCode),
            provider_status_desc: resultDesc,
            provider_transaction_id: providerTransactionId,
            description: `${providerType.toUpperCase()} ${isSuccess ? 'Success' : 'Failed'}. ${resultDesc}`
        });
        console.log(`Transaction ${transaction.id} (Airtel Ref: ${providerRef}) updated to status: ${internalStatus}`);

        if (orderStatusUpdate) {
            await updateOrderStatus(transaction.order_id, orderStatusUpdate);
            console.log(`Order ${transaction.order_id} status updated to: ${orderStatusUpdate}`);
        }

        // --- Send Notifications ---
        const order = await findOrderById(transaction.order_id);
        if (order) {
            if (notificationMessageBuyer) {
                const buyer = await findUserById(order.buyer_id);
                if (buyer?.id && buyer.phone_number) sendSmsNotification(buyer.id.toString(), notificationMessageBuyer);
            }
            if (notificationMessageSeller) {
                const seller = await findUserById(order.seller_id);
                if (seller?.id && seller.phone_number) sendSmsNotification(seller.id.toString(), notificationMessageSeller);
            }
        }

        // Acknowledge successful processing to Airtel
        return { code: '00', message: 'Callback processed successfully.' };

    } catch (dbError: any) {
        console.error(`Airtel Callback DB Error: Failed to update records for Transaction ${transaction.id} (Ref: ${providerRef}). Error:`, dbError);
        // Respond to Airtel indicating an internal error processing the callback
        return { code: '01', message: 'Internal server error processing callback.' };
    }
};

// Helper function (example)
const extractOrderIdFromRef = (ref: string): number | null => {
    if (!ref) return null;
    const match = ref.match(/ORENPAY-AIRTEL-(\d+)-/);
    return match ? parseInt(match[1], 10) : null;
};

/**
 * Initiates an Airtel Money Payout (Disbursement).
 * Requires seller's phone number and amount.
 * NOTE: Verify endpoints, payload, headers, and responses against official Airtel documentation.
 */
export const initiateAirtelPayout = async (
    orderId: number,
    sellerPhone: string,
    amount: number,
    remarks: string
): Promise<{ status: 'initiated' | 'failed' | 'skipped'; message: string; providerRef?: string; error?: any }> => {

    const accessToken = await getAccessToken();
    if (!accessToken) {
        return { status: 'failed', message: 'Failed to get Airtel access token' };
    }

    // TODO: Verify the correct Airtel API endpoint for disbursements/payouts
    const url = `${AIRTEL_API_BASE_URL}/standard/v1/disbursements/`; // Example endpoint

    // Ensure phone number format is correct for Airtel (e.g., might need local format without country code)
    const rawPhoneNumber = sellerPhone;
    if (!rawPhoneNumber) {
        return { status: 'failed', message: 'Seller phone number is missing.' };
    }
    // Example: Convert 2547... to 07... or 7... based on API requirement
    const formattedPhoneNumber = rawPhoneNumber.startsWith('254') ? '0' + rawPhoneNumber.substring(3) : rawPhoneNumber;
    // TODO: Confirm the exact phone number format required by the Airtel API

    // Generate a unique reference for logging and callbacks
    const transactionRef = `ORENPAY-AIRTEL-PAYOUT-${orderId}-${Date.now()}`;

    // TODO: Verify the exact payload structure required by the Airtel Disbursements API
    const payload = {
        // May need a 'country' or 'currency' at the top level
        reference: transactionRef, // Your unique reference
        // pin: airtelConfig.pin, // Fix: Commented out - Verify if PIN is needed and how to handle securely
        payee: {
            msisdn: formattedPhoneNumber, // Recipient's phone number
        },
        transaction: {
            amount: amount,
            id: transactionRef, // Often the same as the main reference
            description: remarks, // Use remarks as description
        },
        // May need additional fields like callback_url
    };

    try {
        console.log(`Initiating Airtel payout request to ${formattedPhoneNumber} for Order ${orderId}, Amount: ${amount}, Ref: ${transactionRef}`);
        console.log('Airtel Payout Payload:', JSON.stringify(payload, null, 2));

        // TODO: Verify required headers (e.g., X-Country, X-Currency)
        const response: AxiosResponse<any> = await axios.post(url, payload, { // Use 'any' for now, define interface later
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Country': 'KE', // Example header
                'X-Currency': 'KES', // Example header
            },
        });

        console.log(`Airtel payout initiation response for Ref: ${transactionRef}. Response:`, response.data);

        // TODO: Check the response structure and status codes from Airtel documentation
        // Example: Check for a specific success indicator (might be synchronous or asynchronous)
        // Assuming asynchronous: API accepts the request, status comes via callback
        if (response.data?.status?.response_code === 'DP00800001001' || response.status === 200 || response.status === 202) { // Example success/accepted codes
            return {
                status: 'initiated',
                message: response.data?.status?.message || 'Payout request accepted by Airtel. Awaiting callback.',
                providerRef: transactionRef, // Return our internal reference
            };
        } else {
            // Handle cases where the API rejects the request immediately
            const errorMessage = response.data?.status?.message || response.data?.description || 'Unknown Airtel payout error';
            console.error(`Airtel payout initiation failed synchronously for Ref ${transactionRef}: ${errorMessage}`, response.data);
            return {
                status: 'failed',
                message: `Airtel payout initiation failed: ${errorMessage}`,
                providerRef: transactionRef,
                error: response.data
            };
        }

    } catch (error: any) {
        const errorMessage = error.response?.data?.description || error.response?.data?.message || error.message;
        console.error(`Error initiating Airtel payout for Ref ${transactionRef}:`, errorMessage, error.response?.data);
         return {
            status: 'failed',
            message: `Failed to initiate Airtel payout: ${errorMessage}`,
            providerRef: transactionRef, // Include ref even on failure for logging
            error: error.response?.data || error.message
        };
    }
};

/**
 * Initiates an Airtel Money Refund (Reversal).
 * Requires the *original* Airtel transaction ID of the payment to be refunded.
 * NOTE: Verify endpoints, payload, headers, and responses against official Airtel documentation.
 */
export const initiateAirtelRefund = async (
    orderId: number, // For logging context
    originalAirtelTxId: string, // The ID from the successful payment callback
    amount: number,
    remarks: string
): Promise<{ status: 'initiated' | 'failed' | 'skipped'; message: string; providerRef?: string; error?: any }> => {

    if (!originalAirtelTxId) {
         return { status: 'failed', message: 'Original Airtel Transaction ID is required for refund.' };
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
        return { status: 'failed', message: 'Failed to get Airtel access token' };
    }

    // TODO: Verify the correct Airtel API endpoint for refunds/reversals
    const url = `${AIRTEL_API_BASE_URL}/standard/v1/payments/${originalAirtelTxId}/refund`; // Example endpoint structure

    // Generate a unique reference for logging and callbacks
    const transactionRef = `ORENPAY-AIRTEL-REFUND-${orderId}-${Date.now()}`;

    // TODO: Verify the exact payload structure required by the Airtel Refund API
    const payload = {
        reference: transactionRef, // Your unique reference for the refund attempt
        transaction: {
            amount: amount,
            id: transactionRef, // Often the same as the main reference
            description: remarks,
            // May need currency, country etc.
        },
        // May need PIN or other auth details
        // pin: airtelConfig.pin, // Fix: Commented out - Verify if PIN is needed and how to handle securely
    };

    try {
        console.log(`Initiating Airtel refund request for Original TxID: ${originalAirtelTxId}, Amount: ${amount}, Ref: ${transactionRef}`);
        console.log('Airtel Refund Payload:', JSON.stringify(payload, null, 2));

        // TODO: Verify required headers
        const response: AxiosResponse<any> = await axios.post(url, payload, { // Use 'any' for now
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-Country': 'KE', // Example header
                'X-Currency': 'KES', // Example header
            },
        });

        console.log(`Airtel refund initiation response for Ref: ${transactionRef}. Response:`, response.data);

        // TODO: Check the response structure and status codes from Airtel documentation
        // Assuming asynchronous: API accepts the request, status comes via callback
        if (response.data?.status?.response_code === 'RFND_ACCEPTED_CODE' || response.status === 200 || response.status === 202) { // Example success/accepted codes
            return {
                status: 'initiated',
                message: response.data?.status?.message || 'Refund request accepted by Airtel. Awaiting callback.',
                providerRef: transactionRef, // Return our internal reference
            };
        } else {
            const errorMessage = response.data?.status?.message || response.data?.description || 'Unknown Airtel refund error';
            console.error(`Airtel refund initiation failed synchronously for Ref ${transactionRef}: ${errorMessage}`, response.data);
            return {
                status: 'failed',
                message: `Airtel refund initiation failed: ${errorMessage}`,
                providerRef: transactionRef,
                error: response.data
            };
        }

    } catch (error: any) {
        const errorMessage = error.response?.data?.description || error.response?.data?.message || error.message;
        console.error(`Error initiating Airtel refund for Ref ${transactionRef}:`, errorMessage, error.response?.data);
        return {
            status: 'failed',
            message: `Failed to initiate Airtel refund: ${errorMessage}`,
            providerRef: transactionRef,
            error: error.response?.data || error.message
        };
    }
};
