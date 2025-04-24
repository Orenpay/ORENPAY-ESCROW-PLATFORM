import { Request, Response } from 'express';
import { findOrderById, updateOrderStatus } from '../models/Order';
import { createTransaction, updateTransactionStatus, findTransactionByProviderRef, updateTransactionDetails } from '../models/Transaction';
import { findUserById } from '../models/User';
import {
    initiateMpesaStkPush,
    handleMpesaCallback,
    handleMpesaTimeout,
    queryMpesaTransactionStatus,
    handleB2CResult, // Import B2C handler
    handleB2CTimeout // Import B2C handler
} from '../services/mpesa';
import { initiateAirtelPayment, handleAirtelCallback } from '../services/airtel';
import { initiateEquityPayment, handleEquityCallback } from '../services/equity';
import { paymentSettings } from '../../config/providers';
import crypto from 'crypto';
import { sendSmsNotification } from '../services/notificationService'; // Import the notification service

/**
 * Initiates payment for a given order based on the selected method.
 * Requires authentication.
 */
export const initiatePayment = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    const { orderId, paymentMethod } = req.body;

    if (!user) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    if (!orderId || !paymentMethod) {
        res.status(400).json({ message: 'Order ID and payment method are required.' });
        return;
    }

    try {
        const order = await findOrderById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        // Authorization: Only the buyer can initiate payment
        if (order.buyer_id !== user.id) {
            res.status(403).json({ message: 'Forbidden: Only the buyer can initiate payment for this order.' });
            return;
        }

        // Check if order is already paid or in a non-payable state
        if (order.status !== 'pending') {
            res.status(400).json({ message: `Order status is '${order.status}', payment cannot be initiated.` });
            return;
        }

        // Fetch buyer details (needed for payment initiation)
        const buyer = await findUserById(user.id);
        if (!buyer) {
            // Should not happen if authenticated, but good practice
            res.status(404).json({ message: 'Buyer details not found.' });
            return;
        }

        let initiationResponse: any;
        let logDescription = `Initiating ${paymentMethod} payment for Order #${orderId}`;

        // Log initial attempt before calling provider
        const initialTransaction = await createTransaction({
            order_id: orderId,
            user_id: user.id,
            provider: paymentMethod,
            amount: order.amount,
            status: 'pending',
            description: logDescription,
        });

        try {
            switch (paymentMethod.toLowerCase()) {
                case 'mpesa':
                    initiationResponse = await initiateMpesaStkPush(order, buyer);
                    logDescription = `M-Pesa STK Push initiated. CheckoutRequestID: ${initiationResponse?.CheckoutRequestID || 'N/A'}`;
                    break;
                case 'airtel':
                    initiationResponse = await initiateAirtelPayment(order, buyer);
                    logDescription = `Airtel Money payment initiated. Ref: ${initiationResponse?.transaction?.id || 'N/A'}`;
                    break;
                case 'equity':
                    initiationResponse = await initiateEquityPayment(order, buyer);
                    logDescription = `Equity Bank payment initiated. Ref: ${initiationResponse?.transactionReference || 'N/A'}`;
                    // Equity might involve a redirect
                    if (initiationResponse?.redirectUrl) {
                        res.status(200).json({ message: 'Payment initiated', redirectUrl: initiationResponse.redirectUrl });
                        return; // Don't send another response
                    }
                    break;
                default:
                    throw new Error('Unsupported payment method.');
            }

            // Update the transaction log with initiation details/references
            await updateTransactionStatus(initialTransaction.id!, 'pending', initiationResponse?.CheckoutRequestID || initiationResponse?.transaction?.id || initiationResponse?.transactionReference, logDescription);

            res.status(200).json({ message: `Payment initiation via ${paymentMethod} successful.`, details: initiationResponse });

        } catch (initiationError: any) {
            console.error(`Error during ${paymentMethod} initiation for Order ${orderId}:`, initiationError);
            // Update transaction log to failed
            await updateTransactionStatus(initialTransaction.id!, 'failed', undefined, `Payment initiation failed: ${initiationError.message}`);
            res.status(500).json({ message: `Failed to initiate payment via ${paymentMethod}.`, error: initiationError.message });
        }

    } catch (error: any) {
        console.error('Error in initiatePayment controller:', error);
        res.status(500).json({ message: 'Internal server error during payment initiation.' });
    }
};

/**
 * Handles the callback from M-Pesa STK Push.
 * Endpoint: /api/payments/mpesa/callback/:orderId
 */
export const mpesaCallbackHandler = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const callbackData = req.body;

    console.log(`Received M-Pesa callback for Order ID: ${orderId}`);
    console.log('Callback Data:', JSON.stringify(callbackData, null, 2));

    // Basic validation: Check if data structure is as expected
    const body = callbackData.Body?.stkCallback;
    if (!body) {
        console.error('Invalid M-Pesa callback format received.');
        // Send generic error response - M-Pesa might retry if it doesn't get 200 OK
        res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback format received.' });
        return;
    }

    const merchantRequestId = body.MerchantRequestID;
    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    try {
        // --- Find the corresponding Transaction using CheckoutRequestID --- 
        // We need to store CheckoutRequestID when initiating the STK push
        const transaction = await findTransactionByProviderRef(checkoutRequestId, 'mpesa');

        if (!transaction) {
            console.error(`Transaction not found for M-Pesa CheckoutRequestID: ${checkoutRequestId}`);
            // Respond to M-Pesa that we couldn't process, but acknowledge receipt
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Acknowledge to prevent retries
            return;
        }

        // Avoid processing the same callback multiple times
        if (transaction.status === 'success' || transaction.status === 'failed') {
            console.warn(`Callback for CheckoutRequestID ${checkoutRequestId} already processed. Current status: ${transaction.status}`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Acknowledge
            return;
        }

        const associatedOrderId = transaction.order_id;
        const order = await findOrderById(associatedOrderId);
        if (!order) {
             console.error(`Order not found (ID: ${associatedOrderId}) for transaction ${transaction.id}`);
             res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Acknowledge
             return;
        }

        // --- Process based on ResultCode --- 
        if (resultCode === 0) {
            // Payment Successful
            const callbackMetadata = body.CallbackMetadata?.Item;
            const amountPaid = callbackMetadata?.find((item: any) => item.Name === 'Amount')?.Value;
            const mpesaReceiptNumber = callbackMetadata?.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
            const transactionDate = callbackMetadata?.find((item: any) => item.Name === 'TransactionDate')?.Value;
            const phoneNumber = callbackMetadata?.find((item: any) => item.Name === 'PhoneNumber')?.Value;

            // Verification: Check if amount paid matches order amount
            if (Number(amountPaid) < order.amount) {
                console.warn(`Potential underpayment for Order ${associatedOrderId}. Expected: ${order.amount}, Received: ${amountPaid}`);
                // Decide how to handle underpayments - maybe flag for admin?
                // For now, proceed but log warning.
            }

            // Update Transaction Status
            await updateTransactionStatus(transaction.id!, 'success', {
                provider_receipt: mpesaReceiptNumber,
                provider_timestamp: transactionDate, // Store the M-Pesa timestamp
                details: `Paid via ${phoneNumber}. Receipt: ${mpesaReceiptNumber}`
            });

            // Update Order Status
            await updateOrderStatus(associatedOrderId, 'paid');

            console.log(`Order ${associatedOrderId} successfully marked as paid. M-Pesa Receipt: ${mpesaReceiptNumber}`);

            // --- Send Notifications --- 
            const successMessageBuyer = `Your payment of KES ${amountPaid} for Order #${associatedOrderId} via M-Pesa was successful. Receipt: ${mpesaReceiptNumber}.`;
            sendSmsNotification(order.buyer_id, successMessageBuyer);

            const successMessageSeller = `Payment of KES ${amountPaid} received for Order #${associatedOrderId} via M-Pesa. Receipt: ${mpesaReceiptNumber}. Prepare for shipment.`;
            sendSmsNotification(order.seller_id, successMessageSeller);

        } else {
            // Payment Failed or Cancelled
            console.error(`M-Pesa Payment Failed/Cancelled for Order ${associatedOrderId}. Code: ${resultCode}, Desc: ${resultDesc}`);

            // Update Transaction Status
            await updateTransactionStatus(transaction.id!, 'failed', {
                 details: `Failed/Cancelled. Code: ${resultCode}, Desc: ${resultDesc}`
            });

            // --- Send Notification --- 
            const failureMessageBuyer = `Your M-Pesa payment for Order #${associatedOrderId} failed. Reason: ${resultDesc}. Please try again or contact support.`;
            sendSmsNotification(order.buyer_id, failureMessageBuyer);
        }

        // Acknowledge receipt to M-Pesa
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    } catch (error: any) {
        console.error(`Error processing M-Pesa callback for Order ${orderId}:`, error);
        // Send a generic error response to M-Pesa, but log the internal error
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal server error during callback processing.' });
    }
};

/**
 * Handles the timeout URL hit from M-Pesa if no callback received.
 * Endpoint: /api/payments/mpesa/timeout/:checkoutRequestId (Assuming URL structure)
 */
export const mpesaTimeoutHandler = async (req: Request, res: Response): Promise<void> => {
    const { checkoutRequestId } = req.params; // Assuming CheckoutRequestID is in the URL
    const requestData = req.body; // M-Pesa might send data here too

    console.warn(`M-Pesa Timeout received for CheckoutRequestID: ${checkoutRequestId}`);
    console.warn('Timeout Data:', JSON.stringify(requestData, null, 2));

    if (!checkoutRequestId) {
        console.error('M-Pesa timeout handler called without CheckoutRequestID.');
        return res.status(400).json({ ResultCode: 1, ResultDesc: 'Missing CheckoutRequestID' });
    }

    try {
        // 1. Find the transaction associated with the CheckoutRequestID
        const transaction = await findTransactionByProviderRef(checkoutRequestId, 'mpesa');

        if (!transaction) {
            console.error(`Transaction not found for M-Pesa CheckoutRequestID: ${checkoutRequestId} during timeout handling.`);
            // Acknowledge receipt, but log error
            return res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Acknowledged, Transaction Not Found' });
        }

        // Only process if the transaction is still pending (wasn't updated by a late callback)
        if (transaction.status !== 'pending') {
            console.warn(`Timeout for ${checkoutRequestId}, but transaction status is already '${transaction.status}'. Ignoring timeout.`);
            return res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Acknowledged, Transaction Already Processed' });
        }

        // 2. Trigger a status query API call to M-Pesa
        console.log(`Querying M-Pesa status for timed-out transaction: ${checkoutRequestId}`);
        const statusResult = await queryMpesaTransactionStatus(checkoutRequestId);

        // 3. Process the result from the status query
        // TODO: Adapt this logic based on the actual response structure of queryMpesaTransactionStatus
        const queryResultCode = statusResult?.ResultCode; // Example path
        const queryResultDesc = statusResult?.ResultDesc; // Example path

        if (queryResultCode === 0) {
            // Transaction was actually SUCCESSFUL despite timeout/missed callback
            console.log(`Status Query for ${checkoutRequestId} revealed SUCCESS. Updating transaction.`);
            // TODO: Extract necessary details (receipt, amount etc.) if available from query response
            const mpesaReceiptNumber = statusResult?.ReceiptNumber || 'N/A_FROM_QUERY'; // Example
            const amountPaid = statusResult?.Amount || transaction.amount; // Example

            await updateTransactionStatus(transaction.id!, 'success', {
                provider_receipt: mpesaReceiptNumber,
                details: `Success confirmed via Status Query after timeout. Desc: ${queryResultDesc}`
            });
            await updateOrderStatus(transaction.order_id, 'paid');

            // Notify users of success (important as they might think it failed)
            const order = await findOrderById(transaction.order_id);
            if (order) {
                const successMessageBuyer = `Update for Order #${order.id}: Your M-Pesa payment was successful (confirmed after timeout). Receipt: ${mpesaReceiptNumber}.`;
                sendSmsNotification(order.buyer_id, successMessageBuyer);
                const successMessageSeller = `Update for Order #${order.id}: Payment received via M-Pesa (confirmed after timeout). Receipt: ${mpesaReceiptNumber}.`;
                sendSmsNotification(order.seller_id, successMessageSeller);
            }

        } else {
            // Transaction FAILED or status is still ambiguous/pending according to M-Pesa
            console.error(`Status Query for ${checkoutRequestId} confirmed FAILURE or ambiguous status. Code: ${queryResultCode}, Desc: ${queryResultDesc}`);
            await updateTransactionStatus(transaction.id!, 'failed', {
                details: `Failed after timeout. Status Query Result: ${queryResultDesc} (Code: ${queryResultCode})`
            });
            // Order status remains 'pending' or could be moved to 'payment_failed'
            // await updateOrderStatus(transaction.order_id, 'payment_failed');

            // Notify buyer of failure
            const order = await findOrderById(transaction.order_id);
            if (order) {
                const failureMessageBuyer = `Your M-Pesa payment for Order #${order.id} could not be confirmed after timeout. Reason: ${queryResultDesc}. Please try again or contact support.`;
                sendSmsNotification(order.buyer_id, failureMessageBuyer);
            }
        }

        // Acknowledge receipt of the timeout notification
        res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Processed' });

    } catch (error: any) {
        console.error(`Error processing M-Pesa timeout for ${checkoutRequestId}:`, error);
        // Acknowledge receipt even on internal error
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal server error during timeout processing.' });
    }
};

/**
 * Handles incoming webhook callbacks from Airtel Money.
 * Endpoint: /api/payments/airtel/callback
 */
export const airtelCallbackHandler = async (req: Request, res: Response): Promise<void> => {
    const callbackData = req.body;
    console.log('Received Airtel Callback:', JSON.stringify(callbackData, null, 2));

    // TODO: Implement robust validation (e.g., signature check, IP filtering)
    // const isValid = validateWebhookSecret(req); // Example validation
    // if (!isValid) {
    //     console.warn('Invalid Airtel callback received.');
    //     return res.status(403).json({ message: 'Forbidden' });
    // }

    // --- Extract necessary data (adjust paths based on actual Airtel callback structure) ---
    const providerRef = callbackData?.transaction?.id; // Example: Unique ID sent during initiation
    const airtelStatus = callbackData?.transaction?.status; // Example: Status code like 'TS' or 'TF'
    const airtelMessage = callbackData?.transaction?.message; // Example: Description from Airtel
    const amount = callbackData?.transaction?.amount; // Example: Amount confirmed by Airtel
    const airtelReceipt = callbackData?.transaction?.airtel_money_id; // Example: Airtel's own transaction ID/receipt

    if (!providerRef) {
        console.error('Airtel callback missing transaction reference ID.');
        // Acknowledge to prevent retries, but log error
        return res.status(200).json({ code: '01', message: 'Callback received but missing reference.' });
    }

    try {
        // --- Find the original transaction ---
        const transaction = await findTransactionByProviderRef(providerRef, 'airtel');

        if (!transaction) {
            console.error(`Transaction not found for Airtel reference: ${providerRef}`);
            // Acknowledge to prevent retries
            return res.status(200).json({ code: '01', message: 'Transaction reference not found.' });
        }

        const orderId = transaction.order_id;
        const order = await findOrderById(orderId); // Fetch order details
        if (!order) {
            console.error(`Order ${orderId} not found for Airtel callback ref ${providerRef}`);
            return res.status(200).json({ code: '01', message: 'Associated order not found.' });
        }

        let internalStatus: 'success' | 'failed' = 'failed';
        let updateDescription = `Airtel callback received. Status: ${airtelStatus || 'Unknown'}. Message: ${airtelMessage || 'N/A'}`;

        // --- Map Airtel status to internal status ---
        if (airtelStatus === 'TS' || airtelStatus === 'SUCCESS') { 
            internalStatus = 'success';
            updateDescription = `Airtel payment successful. Receipt: ${airtelReceipt || 'N/A'}. Message: ${airtelMessage || 'Success'}`;

            // --- Update Order Status on Success --- 
            await updateOrderStatus(orderId, 'paid');
            console.log(`Order ${orderId} marked as paid via Airtel.`);
            
            // --- Send Notifications --- 
            const successMessageBuyer = `Your payment of KES ${amount || order.amount} for Order #${orderId} via Airtel Money was successful. Ref: ${airtelReceipt || providerRef}.`;
            sendSmsNotification(order.buyer_id, successMessageBuyer);

            const successMessageSeller = `Payment of KES ${amount || order.amount} received for Order #${orderId} via Airtel Money. Ref: ${airtelReceipt || providerRef}. Prepare for shipment.`;
            sendSmsNotification(order.seller_id, successMessageSeller);

        } else {
            internalStatus = 'failed';
            updateDescription = `Airtel payment failed. Status: ${airtelStatus || 'Unknown'}. Message: ${airtelMessage || 'Failure'}`;
            
            // --- Send Notification --- 
            const failureMessageBuyer = `Your Airtel Money payment for Order #${orderId} failed. Reason: ${airtelMessage || airtelStatus || 'Unknown'}. Please try again or contact support.`;
            sendSmsNotification(order.buyer_id, failureMessageBuyer);
        }

        // --- Update Transaction Log --- 
        await updateTransactionDetails(transaction.id!, internalStatus, {
            provider_receipt: airtelReceipt,
            description: updateDescription,
        });

        console.log(`Transaction ${transaction.id} updated for Airtel ref ${providerRef}. Status: ${internalStatus}`);

        // --- Acknowledge callback --- 
        res.status(200).json({ code: '00', message: 'Callback processed successfully.' });

    } catch (error: any) {
        console.error(`Error processing Airtel callback for ref ${providerRef}:`, error);
        // Respond with a generic error, but acknowledge receipt if possible
        res.status(500).json({ code: '01', message: 'Internal server error during callback processing.' });
    }
};

/**
 * Handles incoming webhook callbacks from Equity Bank.
 * Endpoint: /api/payments/equity/callback
 */
export const equityCallbackHandler = async (req: Request, res: Response): Promise<void> => {
    const callbackData = req.body;
    const queryParams = req.query;
    console.log('Received Equity Callback:', JSON.stringify(callbackData, null, 2), 'Query:', queryParams);

    // TODO: Implement robust validation (e.g., signature check, IP filtering based on Equity specs)
    // const isValid = validateWebhookSecret(req); // Or HMAC validation
    // if (!isValid) {
    //     console.warn('Invalid Equity callback received.');
    //     return res.status(403).json({ message: 'Forbidden' });
    // }

    // --- Extract necessary data (adjust paths based on actual Equity callback structure) ---
    const providerRef = callbackData?.transactionReference; // Example: Unique ID sent during initiation
    const equityStatus = callbackData?.transactionStatus; // Example: Status like 'Completed' or 'Failed'
    const equityMessage = callbackData?.message || callbackData?.description; // Example: Description from Equity
    const amount = callbackData?.amount; // Example: Amount confirmed by Equity
    const equityReceipt = callbackData?.receiptNumber || callbackData?.externalReference; // Example: Equity's own transaction ID
    const orderIdFromQuery = queryParams?.orderId ? parseInt(queryParams.orderId as string, 10) : null;

    if (!providerRef) {
        console.error('Equity callback missing transaction reference ID.');
        // Acknowledge to prevent retries, but log error
        // TODO: Check Equity expected response format for errors
        return res.status(200).json({ responseCode: '901', responseMessage: 'Callback received but missing reference.' });
    }

    try {
        // --- Find the original transaction --- 
        const transaction = await findTransactionByProviderRef(providerRef, 'equity');

        if (!transaction) {
            console.error(`Transaction not found for Equity reference: ${providerRef}`);
            // Acknowledge to prevent retries
            // TODO: Check Equity expected response format
            return res.status(200).json({ responseCode: '902', responseMessage: 'Transaction reference not found.' });
        }

        const orderId = transaction.order_id;
        const order = await findOrderById(orderId); // Fetch order details
        if (!order) {
            console.error(`Order ${orderId} not found for Equity callback ref ${providerRef}`);
            // TODO: Check Equity expected response format
            return res.status(200).json({ responseCode: '904', responseMessage: 'Associated order not found.' });
        }

        // Optional: Verify orderId from query matches transaction's order_id
        if (orderIdFromQuery && orderIdFromQuery !== orderId) {
            console.error(`Order ID mismatch in Equity callback. Ref: ${providerRef}, DB OrderID: ${orderId}, Query OrderID: ${orderIdFromQuery}`);
            // Decide how to handle mismatch - likely treat as error
            return res.status(200).json({ responseCode: '903', responseMessage: 'Order ID mismatch.' });
        }

        let internalStatus: 'success' | 'failed' = 'failed';
        let updateDescription = `Equity callback received. Status: ${equityStatus || 'Unknown'}. Message: ${equityMessage || 'N/A'}`;

        // --- Map Equity status to internal status --- 
        if (equityStatus === 'Completed' || equityStatus === 'Success' || equityStatus === '000') { 
            internalStatus = 'success';
            updateDescription = `Equity payment successful. Receipt: ${equityReceipt || 'N/A'}. Message: ${equityMessage || 'Success'}`;

            // --- Update Order Status on Success --- 
            await updateOrderStatus(orderId, 'paid');
            console.log(`Order ${orderId} marked as paid via Equity.`);
            
            // --- Send Notifications --- 
            const successMessageBuyer = `Your payment of KES ${amount || order.amount} for Order #${orderId} via Equity Bank was successful. Ref: ${equityReceipt || providerRef}.`;
            sendSmsNotification(order.buyer_id, successMessageBuyer);

            const successMessageSeller = `Payment of KES ${amount || order.amount} received for Order #${orderId} via Equity Bank. Ref: ${equityReceipt || providerRef}. Prepare for shipment.`;
            sendSmsNotification(order.seller_id, successMessageSeller);

        } else {
            internalStatus = 'failed';
            updateDescription = `Equity payment failed. Status: ${equityStatus || 'Unknown'}. Message: ${equityMessage || 'Failure'}`;
            
            // --- Send Notification --- 
            const failureMessageBuyer = `Your Equity Bank payment for Order #${orderId} failed. Reason: ${equityMessage || equityStatus || 'Unknown'}. Please try again or contact support.`;
            sendSmsNotification(order.buyer_id, failureMessageBuyer);
        }

        // --- Update Transaction Log --- 
        await updateTransactionDetails(transaction.id!, internalStatus, {
            provider_receipt: equityReceipt,
            description: updateDescription,
        });

        console.log(`Transaction ${transaction.id} updated for Equity ref ${providerRef}. Status: ${internalStatus}`);

        // --- Acknowledge callback --- 
        res.status(200).json({ responseCode: '000', responseMessage: 'Callback processed successfully.' });

    } catch (error: any) {
        console.error(`Error processing Equity callback for ref ${providerRef}:`, error);
        // Respond with a generic error, but acknowledge receipt if possible
        // TODO: Check Equity expected response format for errors
        res.status(500).json({ responseCode: '999', responseMessage: 'Internal server error during callback processing.' });
    }
};

/**
 * Handles the B2C Result callback from M-Pesa (for payouts).
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/b2c/result)
 */
export const mpesaB2CResultHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa B2C Result Callback');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const callbackData = req.body;

    // Acknowledge receipt immediately to M-Pesa
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

    // Process the callback asynchronously
    try {
        await handleB2CResult(callbackData as any); // Use the service function
    } catch (error) {
        console.error('Error processing B2C Result callback:', error);
        // Error is logged, but we already responded 200 OK to M-Pesa
    }
};

/**
 * Handles the B2C Queue Timeout callback from M-Pesa (for payouts).
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/b2c/timeout)
 */
export const mpesaB2CTimeoutHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa B2C Queue Timeout Callback');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));

    // Acknowledge receipt immediately to M-Pesa
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

    const originatorConversationID = req.body?.Result?.OriginatorConversationID || req.body?.OriginatorConversationID;

    if (!originatorConversationID) {
        console.error('Could not extract OriginatorConversationID from B2C Timeout callback body.');
        return; // Already responded 200 OK
    }

    // Process the timeout asynchronously
    try {
        await handleB2CTimeout(originatorConversationID); // Use the service function
    } catch (error) {
        console.error('Error processing B2C Timeout callback:', error);
        // Error is logged, but we already responded 200 OK to M-Pesa
    }
};

// --- Webhook Validation Helpers (Placeholders) ---

// Example: Basic webhook secret validation (can be used if providers support a simple secret header)
const validateWebhookSecret = (req: Request): boolean => {
    const providedSecret = req.headers['x-webhook-secret']; // Example header
    return providedSecret === paymentSettings.webhookSecret;
};

// Example: HMAC signature validation (more secure)
// Requires raw body middleware (e.g., bodyParser configured not to parse JSON for webhook routes)
const validateHmacSignature = (req: Request, secret: string): boolean => {
    const providedSignature = req.headers['x-hub-signature-256'] as string; // Example header (like GitHub/Facebook)
    if (!providedSignature || !req.rawBody) { // req.rawBody needs middleware
        return false;
    }
    const [algo, signature] = providedSignature.split('=');
    if (algo !== 'sha256') return false; // Only support sha256

    const expectedSignature = crypto.createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
};
