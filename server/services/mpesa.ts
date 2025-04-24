import axios, { AxiosError } from 'axios';
import { Buffer } from 'buffer';
import { mpesaConfig } from '../../config/providers';
import { format } from 'date-fns'; // Using date-fns for timestamp formatting
import { findTransactionByProviderRef, updateTransactionDetails, TransactionStatus, createTransaction } from '../models/Transaction'; // Import transaction models
import { findOrderById, updateOrderStatus, OrderStatus } from '../models/Order'; // Import order models
import { sendSmsNotification } from './notificationService'; // Import notification service

// Define interfaces for expected M-Pesa responses for better type safety
interface MpesaTokenResponse {
    access_token: string;
    expires_in: string;
}

interface MpesaStkPushResponse {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResponseCode: string;
    ResponseDescription: string;
    CustomerMessage: string;
}

interface MpesaB2CResponse {
    OriginatorConversationID: string;
    ConversationID: string;
    ResponseCode: string;
    ResponseDescription: string;
}

interface MpesaErrorResponse {
    requestId?: string;
    errorCode?: string;
    errorMessage?: string;
}

// Interface for the B2C Result callback structure
interface MpesaB2CResultCallback {
    Result: {
        ResultType: number;
        ResultCode: number;
        ResultDesc: string;
        OriginatorConversationID: string;
        ConversationID: string;
        TransactionID: string; // M-Pesa Transaction Receipt
        ResultParameters?: {
            ResultParameter?: (
                | { Key: string; Value: string | number; }
                | { Key: string; Value: string | number; }[] // Can be array or single object
            );
        };
        ReferenceData?: {
            ReferenceItem: { Key: string; Value: string; };
        };
    };
}

// Interface for the B2C Timeout callback structure (Simplified - confirm exact structure if needed)
interface MpesaB2CTimeoutCallback {
    OriginatorConversationID?: string; // Assuming controller might extract this if present
}

// Determine API base URL based on environment
const MPESA_API_BASE_URL = mpesaConfig.environment === 'production' 
    ? 'https://api.safaricom.co.ke' 
    : 'https://sandbox.safaricom.co.ke';

/**
 * Generates M-Pesa Daraja API access token.
 * @returns {Promise<string>} The access token.
 */
export const getMpesaToken = async (): Promise<string> => {
    const auth = Buffer.from(`${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`).toString('base64');
    
    try {
        const response = await axios.get<MpesaTokenResponse>(`${MPESA_API_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });
        
        if (response.data && response.data.access_token) {
            console.log('M-Pesa token generated successfully.');
            return response.data.access_token;
        } else {
            console.error('M-Pesa token response missing access_token:', response.data);
            throw new Error('M-Pesa token generation failed: Invalid response format.');
        }
    } catch (error: any) {
        const axiosError = error as AxiosError<MpesaErrorResponse>;
        const errorData = axiosError.response?.data;
        console.error('Error getting M-Pesa token:', errorData || axiosError.message);
        throw new Error(`M-Pesa token generation failed: ${errorData?.errorMessage || axiosError.message}`);
    }
};

/**
 * Initiates an M-Pesa STK Push request.
 * @param {number} orderId - The internal order ID for reference.
 * @param {string} phoneNumber - The customer's phone number (MSISDN format: 254...).
 * @param {number} amount - The amount to be paid.
 * @returns {Promise<MpesaStkPushResponse>} The response from the M-Pesa API.
 */
export const initiateStkPush = async (orderId: number, phoneNumber: string, amount: number): Promise<MpesaStkPushResponse> => {
    const token = await getMpesaToken();
    const timestamp = format(new Date(), 'yyyyMMddHHmmss'); // Format: YYYYMMDDHHMMSS
    const password = Buffer.from(`${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`).toString('base64');

    // Ensure phone number is in the correct format (e.g., 2547XXXXXXXX)
    const formattedPhoneNumber = phoneNumber.startsWith('+') 
        ? phoneNumber.substring(1) 
        : phoneNumber.startsWith('0') 
        ? `254${phoneNumber.substring(1)}` 
        : phoneNumber;

    if (!formattedPhoneNumber.startsWith('254') || formattedPhoneNumber.length !== 12) {
        throw new Error(`Invalid phone number format: ${phoneNumber}. Must be in 254XXXXXXXXX format.`);
    }

    const payload = {
        BusinessShortCode: mpesaConfig.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline', // or 'CustomerBuyGoodsOnline' depending on registration
        Amount: Math.round(amount), // Amount must be an integer
        PartyA: formattedPhoneNumber, // Customer phone number
        PartyB: mpesaConfig.shortcode, // Your Paybill or Till Number
        PhoneNumber: formattedPhoneNumber, // Customer phone number again
        CallBackURL: `${mpesaConfig.stkCallbackUrlBase}/${orderId}`, // Append orderId for tracking
        AccountReference: `ORENPAY-${orderId}`, // Unique identifier for the transaction
        TransactionDesc: `Payment for OrenPay Order #${orderId}`
    };

    try {
        console.log(`Initiating STK Push for Order ${orderId} to ${formattedPhoneNumber} for KES ${amount}`);
        const response = await axios.post<MpesaStkPushResponse>(`${MPESA_API_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`STK Push initiated for Order ${orderId}. Response:`, response.data);
        // Check M-Pesa response code for immediate success/failure indication
        if (response.data && response.data.ResponseCode === '0') {
            return response.data; // Contains MerchantRequestID and CheckoutRequestID
        } else {
            throw new Error(`STK Push initiation failed: ${response.data.ResponseDescription || 'Unknown error'}`);
        }

    } catch (error: any) {
        const axiosError = error as AxiosError<MpesaErrorResponse>;
        const errorData = axiosError.response?.data;
        console.error(`Error initiating STK Push for Order ${orderId}:`, errorData || axiosError.message);
        // Rethrow a more specific error
        const errorMessage = errorData?.errorMessage || axiosError.message;
        throw new Error(`STK Push failed: ${errorMessage}`);
    }
};

/**
 * Initiates an M-Pesa B2C (Business to Customer) payment.
 * Used for paying out sellers.
 * @param {string} phoneNumber - The recipient's phone number (seller).
 * @param {number} amount - The amount to send.
 * @param {string} remarks - Remarks for the transaction (e.g., "Payout for Order #123").
 * @param {string} occasion - Occasion for the payment (optional).
 * @param {string} commandId - The type of B2C transaction (e.g., 'BusinessPayment', 'SalaryPayment', 'PromotionPayment'). Defaults to 'BusinessPayment'.
 * @returns {Promise<MpesaB2CResponse>} The response from the M-Pesa API.
 */
export const initiateB2CPayment = async (
    phoneNumber: string,
    amount: number,
    remarks: string,
    occasion: string = 'OrenPay Payout',
    commandId: string = 'BusinessPayment'
): Promise<MpesaB2CResponse> => {
    const token = await getMpesaToken();

    // Ensure phone number is in the correct format
    const formattedPhoneNumber = phoneNumber.startsWith('+') 
        ? phoneNumber.substring(1) 
        : phoneNumber.startsWith('0') 
        ? `254${phoneNumber.substring(1)}` 
        : phoneNumber;

    if (!formattedPhoneNumber.startsWith('254') || formattedPhoneNumber.length !== 12) {
        throw new Error(`Invalid recipient phone number format: ${phoneNumber}. Must be in 254XXXXXXXXX format.`);
    }

    if (!mpesaConfig.b2cSecurityCredential) {
        console.error('FATAL: M-Pesa B2C Security Credential is not configured in .env');
        throw new Error('M-Pesa B2C Security Credential not configured.');
    }

    const payload = {
        InitiatorName: mpesaConfig.b2cInitiatorName,
        SecurityCredential: mpesaConfig.b2cSecurityCredential,
        CommandID: commandId,
        Amount: Math.round(amount),
        PartyA: mpesaConfig.shortcode, // Your organization's shortcode
        PartyB: formattedPhoneNumber, // Recipient's phone number
        Remarks: remarks,
        QueueTimeOutURL: mpesaConfig.b2cQueueTimeoutURL,
        ResultURL: mpesaConfig.b2cResultURL,
        Occassion: occasion
    };

    try {
        console.log(`Initiating B2C payment to ${formattedPhoneNumber} for KES ${amount}. Remarks: ${remarks}`);
        const response = await axios.post<MpesaB2CResponse>(`${MPESA_API_BASE_URL}/mpesa/b2c/v1/paymentrequest`, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`B2C payment initiated. Response:`, response.data);
        // Check M-Pesa response code for immediate success/failure indication
        if (response.data && response.data.ResponseCode === '0') {
            return response.data;
        } else {
            throw new Error(`B2C initiation failed: ${response.data.ResponseDescription || 'Unknown M-Pesa error'}`);
        }

    } catch (error: any) {
        const axiosError = error as AxiosError<MpesaErrorResponse>;
        const errorData = axiosError.response?.data;
        console.error(`Error initiating B2C payment:`, errorData || axiosError.message);
        const errorMessage = errorData?.errorMessage || axiosError.message;
        throw new Error(`B2C initiation failed: ${errorMessage}`);
    }
};

/**
 * Handles the M-Pesa B2C Result callback.
 * Updates transaction and order status based on the payout result.
 * @param callbackData - The parsed JSON data from the M-Pesa callback.
 */
export const handleB2CResult = async (callbackData: MpesaB2CResultCallback): Promise<void> => {
    console.log('Handling M-Pesa B2C Result Callback:', JSON.stringify(callbackData, null, 2));

    const { Result } = callbackData;
    if (!Result) {
        console.error('Invalid B2C Result callback format: Missing Result object.');
        return;
    }

    const { OriginatorConversationID, ResultCode, ResultDesc, TransactionID } = Result;

    const transaction = await findTransactionByProviderRef(OriginatorConversationID, 'mpesa_b2c');

    if (!transaction) {
        console.error(`B2C Result Callback: Original transaction not found for OriginatorConversationID: ${OriginatorConversationID}`);
        return;
    }

    if (transaction.status === 'success' || transaction.status === 'failed') {
        console.warn(`B2C Result Callback: Transaction ${transaction.id} already processed with status ${transaction.status}. Ignoring.`);
        return;
    }

    let newStatus: TransactionStatus;
    let newOrderStatus: OrderStatus | null = null;
    let updateDescription = ResultDesc;
    let providerReceipt: string | undefined = TransactionID;
    let providerTimestamp: string | undefined;

    const params = Result.ResultParameters?.ResultParameter;
    let transactionDetails: { [key: string]: string | number } = {};
    if (params) {
        const paramsArray = Array.isArray(params) ? params : [params];
        paramsArray.forEach(p => { transactionDetails[p.Key] = p.Value; });
        providerTimestamp = transactionDetails['TransactionCompletedDateTime'] as string;
    }

    if (ResultCode === 0) {
        console.log(`B2C Payout Successful for OriginatorConversationID: ${OriginatorConversationID}, TransactionID: ${TransactionID}`);
        newStatus = 'success';
        newOrderStatus = 'completed';
        updateDescription = `Payout successful. M-Pesa Receipt: ${TransactionID}. ${ResultDesc}`;
    } else {
        console.error(`B2C Payout Failed for OriginatorConversationID: ${OriginatorConversationID}. ResultCode: ${ResultCode}, Desc: ${ResultDesc}`);
        newStatus = 'failed';
        newOrderStatus = 'delivered';
        updateDescription = `Payout failed. Reason: ${ResultDesc} (Code: ${ResultCode})`;
    }

    try {
        await updateTransactionDetails(transaction.id!, newStatus, {
            provider_receipt: providerReceipt,
            provider_timestamp: providerTimestamp,
            description: updateDescription,
        });
        console.log(`Transaction ${transaction.id} updated to status: ${newStatus}`);

        if (newOrderStatus) {
            await updateOrderStatus(transaction.order_id, newOrderStatus);
            console.log(`Order ${transaction.order_id} status updated to: ${newOrderStatus}`);
        }

    } catch (error) {
        console.error(`Error updating database after B2C Result callback for OriginatorConversationID ${OriginatorConversationID}:`, error);
    }
};

/**
 * Handles the M-Pesa B2C Queue Timeout callback.
 * Marks the transaction as failed if it hasn't been processed yet.
 * @param originatorConversationID - The OriginatorConversationID for the timed-out request.
 */
export const handleB2CTimeout = async (originatorConversationID: string): Promise<void> => {
    console.log(`Handling M-Pesa B2C Timeout for OriginatorConversationID: ${originatorConversationID}`);

    if (!originatorConversationID) {
        console.error('B2C Timeout Callback: Missing OriginatorConversationID.');
        return;
    }

    const transaction = await findTransactionByProviderRef(originatorConversationID, 'mpesa_b2c');

    if (!transaction) {
        console.error(`B2C Timeout Callback: Original transaction not found for OriginatorConversationID: ${originatorConversationID}`);
        return;
    }

    if (transaction.status === 'pending') {
        console.warn(`B2C Payout Timed Out for OriginatorConversationID: ${originatorConversationID}. Marking as failed.`);
        const newStatus: TransactionStatus = 'failed';
        const newOrderStatus: OrderStatus = 'delivered';
        const updateDescription = 'Payout timed out waiting for response from M-Pesa.';

        try {
            await updateTransactionDetails(transaction.id!, newStatus, { description: updateDescription });
            console.log(`Transaction ${transaction.id} updated to status: ${newStatus} due to timeout.`);

            await updateOrderStatus(transaction.order_id, newOrderStatus);
            console.log(`Order ${transaction.order_id} status updated to: ${newOrderStatus} due to payout timeout.`);

        } catch (error) {
            console.error(`Error updating database after B2C Timeout callback for OriginatorConversationID ${originatorConversationID}:`, error);
        }
    } else {
        console.log(`B2C Timeout Callback: Transaction ${transaction.id} already has status ${transaction.status}. Ignoring timeout.`);
    }
};

/**
 * Handles the callback received from M-Pesa after STK Push attempt.
 * This function will be called by the paymentController.
 * @param {any} callbackData - The data received from M-Pesa.
 * @returns {Promise<void>}
 */
export const handleMpesaCallback = async (callbackData: any): Promise<void> => {
    console.log('Received M-Pesa Callback:', JSON.stringify(callbackData, null, 2));

    const body = callbackData.Body?.stkCallback;

    if (!body) {
        console.error('Invalid M-Pesa callback format: Missing Body.stkCallback');
        return;
    }

    const merchantRequestId = body.MerchantRequestID;
    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    if (resultCode === 0) {
        console.log(`M-Pesa Payment Successful for CheckoutRequestID: ${checkoutRequestId}`);
        const callbackMetadata = body.CallbackMetadata?.Item;
        const amount = callbackMetadata?.find((item: any) => item.Name === 'Amount')?.Value;
        const mpesaReceiptNumber = callbackMetadata?.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
        const transactionDate = callbackMetadata?.find((item: any) => item.Name === 'TransactionDate')?.Value;
        const phoneNumber = callbackMetadata?.find((item: any) => item.Name === 'PhoneNumber')?.Value;

        console.log(`Order [ORDER_ID_PLACEHOLDER] marked as paid. Receipt: ${mpesaReceiptNumber}`);

    } else {
        console.error(`M-Pesa Payment Failed/Cancelled for CheckoutRequestID: ${checkoutRequestId}. Code: ${resultCode}, Desc: ${resultDesc}`);
    }
};

/**
 * Handles the timeout URL callback from M-Pesa.
 * This might be called if the main callback fails or times out.
 */
export const handleMpesaTimeout = async (checkoutRequestId: string): Promise<void> => {
    console.warn(`Timeout received or triggered for CheckoutRequestID: ${checkoutRequestId}. Consider querying transaction status.`);
};

/**
 * Queries the status of an M-Pesa STK Push transaction.
 * (Placeholder - Requires implementation using M-Pesa Transaction Status API)
 * @param checkoutRequestId The CheckoutRequestID of the transaction to query.
 * @returns Promise<any> - The result from the status query API.
 */
export const queryMpesaTransactionStatus = async (checkoutRequestId: string): Promise<any> => {
    console.warn(`TODO: Implement M-Pesa Transaction Status Query API call for CheckoutRequestID: ${checkoutRequestId}`);
    return Promise.resolve({ ResultCode: -1, ResultDesc: "Status query not implemented" }); 
};
