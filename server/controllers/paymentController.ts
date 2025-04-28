import { Request, Response } from 'express';
import { findOrderById, updateOrderStatus, OrderStatus } from '../models/Order'; // Added OrderStatus
import { createTransaction, updateTransactionDetails, findTransactionByProviderRef } from '../models/Transaction';
import { findUserById, User } from '../models/User'; // Import User type
import {
    initiateStkPush,
    handleMpesaCallback,
    handleMpesaTimeout,
    queryMpesaTransactionStatus,
    handleB2CResult,
    handleB2CTimeout,
    handleReversalResult,
    handleReversalTimeout,
    MpesaB2CResultCallback,
    MpesaReversalResultCallback
} from '../services/mpesa';
import { initiateAirtelPayment, handleAirtelCallback } from '../services/airtel';
import { initiateEquityPayment, handleEquityCallback } from '../services/equity';
import { paymentSettings } from '../../config/providers';
import crypto from 'crypto';
import { sendSmsNotification } from '../services/notificationService';

// Define a type for requests that might have a rawBody
interface RequestWithRawBody extends Request {
    rawBody?: Buffer;
}

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
                    // Fix: Pass correct arguments: orderId, phoneNumber, amount
                    if (!buyer.phone_number) {
                        throw new Error('Buyer phone number is required for M-Pesa payment.');
                    }
                    initiationResponse = await initiateStkPush(order.id!, buyer.phone_number, order.amount);
                    logDescription = `M-Pesa STK Push initiated. CheckoutRequestID: ${initiationResponse?.CheckoutRequestID || 'N/A'}`;
                    break;
                case 'airtel':
                    initiationResponse = await initiateAirtelPayment(order, buyer);
                    logDescription = `Airtel Money payment initiated. Ref: ${initiationResponse?.transaction?.id || 'N/A'}`;
                    break;
                case 'equity':
                    initiationResponse = await initiateEquityPayment(order, buyer);
                    logDescription = `Equity Bank payment initiated. Ref: ${initiationResponse?.transactionReference || 'N/A'}`;
                    if (initiationResponse?.redirectUrl) {
                        res.status(200).json({ message: 'Payment initiated', redirectUrl: initiationResponse.redirectUrl });
                        return;
                    }
                    break;
                default:
                    throw new Error('Unsupported payment method.');
            }

            await updateTransactionDetails(initialTransaction.id!, 'pending', {
                provider_ref: initiationResponse?.CheckoutRequestID || initiationResponse?.transaction?.id || initiationResponse?.transactionReference,
                description: logDescription
            });

            res.status(200).json({ message: `Payment initiation via ${paymentMethod} successful.`, details: initiationResponse });

        } catch (initiationError: any) {
            console.error(`Error during ${paymentMethod} initiation for Order ${orderId}:`, initiationError);
            await updateTransactionDetails(initialTransaction.id!, 'failed', {
                description: `Payment initiation failed: ${initiationError.message}`
            });
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

    const body = callbackData.Body?.stkCallback;
    if (!body) {
        console.error('Invalid M-Pesa callback format received.');
        res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback format received.' });
        return;
    }

    const merchantRequestId = body.MerchantRequestID;
    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    try {
        const transaction = await findTransactionByProviderRef(checkoutRequestId, 'mpesa');

        if (!transaction) {
            console.error(`Transaction not found for M-Pesa CheckoutRequestID: ${checkoutRequestId}`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
            return;
        }

        if (transaction.status === 'success' || transaction.status === 'failed') {
            console.warn(`Callback for CheckoutRequestID ${checkoutRequestId} already processed. Current status: ${transaction.status}`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
            return;
        }

        const associatedOrderId = transaction.order_id;
        const order = await findOrderById(associatedOrderId);
        if (!order) {
            console.error(`Order not found (ID: ${associatedOrderId}) for transaction ${transaction.id}`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
            return;
        }

        if (resultCode === 0) {
            const callbackMetadata = body.CallbackMetadata?.Item;
            const amountPaid = callbackMetadata?.find((item: any) => item.Name === 'Amount')?.Value;
            const mpesaReceiptNumber = callbackMetadata?.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
            const transactionDate = callbackMetadata?.find((item: any) => item.Name === 'TransactionDate')?.Value;
            const phoneNumber = callbackMetadata?.find((item: any) => item.Name === 'PhoneNumber')?.Value;

            if (Number(amountPaid) < order.amount) {
                console.warn(`Potential underpayment for Order ${associatedOrderId}. Expected: ${order.amount}, Received: ${amountPaid}`);
            }

            await updateTransactionDetails(transaction.id!, 'success', {
                provider_ref: mpesaReceiptNumber,
                provider_timestamp: String(transactionDate),
                description: `Paid via ${phoneNumber}. Receipt: ${mpesaReceiptNumber}`
            });

            await updateOrderStatus(associatedOrderId, 'paid');

            console.log(`Order ${associatedOrderId} successfully marked as paid. M-Pesa Receipt: ${mpesaReceiptNumber}`);

            const successMessageBuyer = `Your payment of KES ${amountPaid} for Order #${associatedOrderId} via M-Pesa was successful. Receipt: ${mpesaReceiptNumber}.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, successMessageBuyer);
            }

            const successMessageSeller = `Payment of KES ${amountPaid} received for Order #${associatedOrderId} via M-Pesa. Receipt: ${mpesaReceiptNumber}. Prepare for shipment.`;
            const sellerUser = await findUserById(order.seller_id);
            if (sellerUser?.phone_number) {
                sendSmsNotification(sellerUser.phone_number, successMessageSeller);
            }

        } else {
            console.error(`M-Pesa Payment Failed/Cancelled for Order ${associatedOrderId}. Code: ${resultCode}, Desc: ${resultDesc}`);

            await updateTransactionDetails(transaction.id!, 'failed', {
                provider_ref: checkoutRequestId,
                description: `Failed/Cancelled. Code: ${resultCode}, Desc: ${resultDesc}`
            });

            const failureMessageBuyer = `Your M-Pesa payment for Order #${associatedOrderId} failed. Reason: ${resultDesc}. Please try again or contact support.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, failureMessageBuyer);
            }
        }

        res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    } catch (error: any) {
        console.error(`Error processing M-Pesa callback for Order ${orderId}:`, error);
        res.status(500).json({ ResultCode: 1, ResultDesc: 'Internal server error during callback processing.' });
    }
};

/**
 * Handles the timeout URL hit from M-Pesa if no callback received.
 * Endpoint: /api/payments/mpesa/timeout/:checkoutRequestId
 */
export const mpesaTimeoutHandler = async (req: Request, res: Response): Promise<void> => {
    const { checkoutRequestId } = req.params;
    const requestData = req.body;

    console.warn(`M-Pesa Timeout received for CheckoutRequestID: ${checkoutRequestId}`);
    console.warn('Timeout Data:', JSON.stringify(requestData, null, 2));

    if (!checkoutRequestId) {
        console.error('M-Pesa timeout handler called without CheckoutRequestID.');
        res.status(400).json({ ResultCode: 1, ResultDesc: 'Missing CheckoutRequestID' });
        return;
    }

    try {
        const transaction = await findTransactionByProviderRef(checkoutRequestId, 'mpesa');

        if (!transaction) {
            console.error(`Transaction not found for M-Pesa CheckoutRequestID: ${checkoutRequestId} during timeout handling.`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Acknowledged, Transaction Not Found' });
            return;
        }

        if (transaction.status !== 'pending') {
            console.warn(`Timeout for ${checkoutRequestId}, but transaction status is already '${transaction.status}'. Ignoring timeout.`);
            res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Acknowledged, Transaction Already Processed' });
            return;
        }

        console.log(`Querying M-Pesa status for timed-out transaction: ${checkoutRequestId}`);
        const statusResult = await queryMpesaTransactionStatus(checkoutRequestId);

        const queryResultCode = statusResult?.ResultCode;
        const queryResultDesc = statusResult?.ResultDesc;

        if (queryResultCode === 0) {
            console.log(`Status Query for ${checkoutRequestId} revealed SUCCESS. Updating transaction.`);
            const mpesaReceiptNumber = statusResult?.ReceiptNumber || 'N/A_FROM_QUERY';
            const amountPaid = statusResult?.Amount || transaction.amount;

            await updateTransactionDetails(transaction.id!, 'success', {
                provider_ref: mpesaReceiptNumber,
                description: `Success confirmed via Status Query after timeout. Desc: ${queryResultDesc}`
            });
            await updateOrderStatus(transaction.order_id, 'paid');

            const order = await findOrderById(transaction.order_id);
            if (order) {
                const successMessageBuyer = `Update for Order #${order.id}: Your M-Pesa payment was successful (confirmed after timeout). Receipt: ${mpesaReceiptNumber}.`;
                const buyerUser = await findUserById(order.buyer_id);
                if (buyerUser?.phone_number) {
                    sendSmsNotification(buyerUser.phone_number, successMessageBuyer);
                }

                const successMessageSeller = `Update for Order #${order.id}: Payment received via M-Pesa (confirmed after timeout). Receipt: ${mpesaReceiptNumber}.`;
                const sellerUser = await findUserById(order.seller_id);
                if (sellerUser?.phone_number) {
                    sendSmsNotification(sellerUser.phone_number, successMessageSeller);
                }
            }

        } else {
            console.error(`Status Query for ${checkoutRequestId} confirmed FAILURE or ambiguous status. Code: ${queryResultCode}, Desc: ${queryResultDesc}`);
            await updateTransactionDetails(transaction.id!, 'failed', {
                provider_ref: checkoutRequestId,
                description: `Failed after timeout. Status Query Result: ${queryResultDesc} (Code: ${queryResultCode})`
            });

            const order = await findOrderById(transaction.order_id);
            if (order) {
                const failureMessageBuyer = `Your M-Pesa payment for Order #${order.id} could not be confirmed after timeout. Reason: ${queryResultDesc}. Please try again or contact support.`;
                const buyerUser = await findUserById(order.buyer_id);
                if (buyerUser?.phone_number) {
                    sendSmsNotification(buyerUser.phone_number, failureMessageBuyer);
                }
            }
        }

        res.status(200).json({ ResultCode: 0, ResultDesc: 'Timeout Processed' });

    } catch (error: any) {
        console.error(`Error processing M-Pesa timeout for ${checkoutRequestId}:`, error);
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

    const providerRef = callbackData?.transaction?.id;
    const airtelStatus = callbackData?.transaction?.status;
    const airtelMessage = callbackData?.transaction?.message;
    const amount = callbackData?.transaction?.amount;
    const airtelReceipt = callbackData?.transaction?.airtel_money_id;

    if (!providerRef) {
        console.error('Airtel callback missing transaction reference ID.');
        res.status(200).json({ code: '01', message: 'Callback received but missing reference.' });
        return;
    }

    try {
        const transaction = await findTransactionByProviderRef(providerRef, 'airtel');

        if (!transaction) {
            console.error(`Transaction not found for Airtel reference: ${providerRef}`);
            res.status(200).json({ code: '01', message: 'Transaction reference not found.' });
            return;
        }

        const orderId = transaction.order_id;
        const order = await findOrderById(orderId);
        if (!order) {
            console.error(`Order ${orderId} not found for Airtel callback ref ${providerRef}`);
            res.status(200).json({ code: '01', message: 'Associated order not found.' });
            return;
        }

        let internalStatus: 'success' | 'failed' = 'failed';
        let updateDescription = `Airtel callback received. Status: ${airtelStatus || 'Unknown'}. Message: ${airtelMessage || 'N/A'}`;

        if (airtelStatus === 'TS' || airtelStatus === 'SUCCESS') {
            internalStatus = 'success';
            updateDescription = `Airtel payment successful. Receipt: ${airtelReceipt || 'N/A'}. Message: ${airtelMessage || 'Success'}`;

            await updateOrderStatus(orderId, 'paid');
            console.log(`Order ${orderId} marked as paid via Airtel.`);
            
            const successMessageBuyer = `Your payment of KES ${amount || order.amount} for Order #${orderId} via Airtel Money was successful. Ref: ${airtelReceipt || providerRef}.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, successMessageBuyer);
            }

            const successMessageSeller = `Payment of KES ${amount || order.amount} received for Order #${orderId} via Airtel Money. Ref: ${airtelReceipt || providerRef}. Prepare for shipment.`;
            const sellerUser = await findUserById(order.seller_id);
            if (sellerUser?.phone_number) {
                sendSmsNotification(sellerUser.phone_number, successMessageSeller);
            }

        } else {
            internalStatus = 'failed';
            updateDescription = `Airtel payment failed. Status: ${airtelStatus || 'Unknown'}. Message: ${airtelMessage || 'Failure'}`;
            
            const failureMessageBuyer = `Your Airtel Money payment for Order #${orderId} failed. Reason: ${airtelMessage || airtelStatus || 'Unknown'}. Please try again or contact support.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, failureMessageBuyer);
            }
        }

        await updateTransactionDetails(transaction.id!, internalStatus, {
            provider_ref: airtelReceipt,
            description: updateDescription,
        });

        console.log(`Transaction ${transaction.id} updated for Airtel ref ${providerRef}. Status: ${internalStatus}`);

        res.status(200).json({ code: '00', message: 'Callback processed successfully.' });

    } catch (error: any) {
        console.error(`Error processing Airtel callback for ref ${providerRef}:`, error);
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

    const providerRef = callbackData?.transactionReference;
    const equityStatus = callbackData?.transactionStatus;
    const equityMessage = callbackData?.message || callbackData?.description;
    const amount = callbackData?.amount;
    const equityReceipt = callbackData?.receiptNumber || callbackData?.externalReference;
    const orderIdFromQuery = queryParams?.orderId ? parseInt(queryParams.orderId as string, 10) : null;

    if (!providerRef) {
        console.error('Equity callback missing transaction reference ID.');
        res.status(200).json({ responseCode: '901', responseMessage: 'Callback received but missing reference.' });
        return;
    }

    try {
        const transaction = await findTransactionByProviderRef(providerRef, 'equity');

        if (!transaction) {
            console.error(`Transaction not found for Equity reference: ${providerRef}`);
            res.status(200).json({ responseCode: '902', responseMessage: 'Transaction reference not found.' });
            return;
        }

        const orderId = transaction.order_id;
        const order = await findOrderById(orderId);
        if (!order) {
            console.error(`Order ${orderId} not found for Equity callback ref ${providerRef}`);
            res.status(200).json({ responseCode: '904', responseMessage: 'Associated order not found.' });
            return;
        }

        if (orderIdFromQuery && orderIdFromQuery !== orderId) {
            console.error(`Order ID mismatch in Equity callback. Ref: ${providerRef}, DB OrderID: ${orderId}, Query OrderID: ${orderIdFromQuery}`);
            res.status(200).json({ responseCode: '903', responseMessage: 'Order ID mismatch.' });
            return;
        }

        let internalStatus: 'success' | 'failed' = 'failed';
        let updateDescription = `Equity callback received. Status: ${equityStatus || 'Unknown'}. Message: ${equityMessage || 'N/A'}`;

        if (equityStatus === 'Completed' || equityStatus === 'Success' || equityStatus === '000') {
            internalStatus = 'success';
            updateDescription = `Equity payment successful. Receipt: ${equityReceipt || 'N/A'}. Message: ${equityMessage || 'Success'}`;

            await updateOrderStatus(orderId, 'paid');
            console.log(`Order ${orderId} marked as paid via Equity.`);
            
            const successMessageBuyer = `Your payment of KES ${amount || order.amount} for Order #${orderId} via Equity Bank was successful. Ref: ${equityReceipt || providerRef}.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, successMessageBuyer);
            }

            const successMessageSeller = `Payment of KES ${amount || order.amount} received for Order #${orderId} via Equity Bank. Ref: ${equityReceipt || providerRef}. Prepare for shipment.`;
            const sellerUser = await findUserById(order.seller_id);
            if (sellerUser?.phone_number) {
                sendSmsNotification(sellerUser.phone_number, successMessageSeller);
            }

        } else {
            internalStatus = 'failed';
            updateDescription = `Equity payment failed. Status: ${equityStatus || 'Unknown'}. Message: ${equityMessage || 'Failure'}`;
            
            const failureMessageBuyer = `Your Equity Bank payment for Order #${orderId} failed. Reason: ${equityMessage || equityStatus || 'Unknown'}. Please try again or contact support.`;
            const buyerUser = await findUserById(order.buyer_id);
            if (buyerUser?.phone_number) {
                sendSmsNotification(buyerUser.phone_number, failureMessageBuyer);
            }
        }

        await updateTransactionDetails(transaction.id!, internalStatus, {
            provider_ref: equityReceipt,
            description: updateDescription,
        });

        console.log(`Transaction ${transaction.id} updated for Equity ref ${providerRef}. Status: ${internalStatus}`);

        res.status(200).json({ responseCode: '000', responseMessage: 'Callback processed successfully.' });

    } catch (error: any) {
        console.error(`Error processing Equity callback for ref ${providerRef}:`, error);
        res.status(500).json({ responseCode: '999', responseMessage: 'Internal server error during callback processing.' });
    }
};

/**
 * Handles the B2C Result callback from M-Pesa (for payouts).
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/b2c/result)
 */
export const mpesaB2CResultHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa B2C Result Callback:', JSON.stringify(req.body, null, 2));
    // Acknowledge M-Pesa immediately
    res.status(200).json({ ResultCode: '0', ResultDesc: 'Callback received successfully.' });
    try {
        // Delegate processing to the service
        await handleB2CResult(req.body as MpesaB2CResultCallback);
    } catch (error: any) {
        console.error('Error processing M-Pesa B2C Result callback in controller:', error);
        // Don't send error back to Safaricom, just log it internally.
    }
};

/**
 * Handles the B2C Timeout callback from M-Pesa.
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/b2c/timeout)
 */
export const mpesaB2CTimeoutHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa B2C Timeout Callback:', JSON.stringify(req.body, null, 2));
    // Acknowledge M-Pesa immediately
    res.status(200).json({ ResultCode: '0', ResultDesc: 'Timeout received successfully.' });
    try {
        // Extract OriginatorConversationID if available (might be in body or query)
        const originatorConversationID = req.body?.OriginatorConversationID || req.query?.OriginatorConversationID;
        if (originatorConversationID) {
            await handleB2CTimeout(originatorConversationID as string);
        } else {
            console.error('M-Pesa B2C Timeout handler: Could not extract OriginatorConversationID from request.');
        }
    } catch (error: any) {
        console.error('Error processing M-Pesa B2C Timeout callback in controller:', error);
    }
};

/**
 * Handles the Reversal Result callback from M-Pesa (for refunds).
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/reversal/result)
 */
export const mpesaReversalResultHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa Reversal Result Callback:', JSON.stringify(req.body, null, 2));
    // Acknowledge M-Pesa immediately
    res.status(200).json({ ResultCode: '0', ResultDesc: 'Callback received successfully.' });
    try {
        // Delegate processing to the service
        await handleReversalResult(req.body as MpesaReversalResultCallback);
    } catch (error: any) {
        console.error('Error processing M-Pesa Reversal Result callback in controller:', error);
    }
};

/**
 * Handles the Reversal Timeout callback from M-Pesa.
 * Endpoint: Configured in M-Pesa Portal (e.g., /api/payments/mpesa/reversal/timeout)
 */
export const mpesaReversalTimeoutHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Received M-Pesa Reversal Timeout Callback:', JSON.stringify(req.body, null, 2));
    // Acknowledge M-Pesa immediately
    res.status(200).json({ ResultCode: '0', ResultDesc: 'Timeout received successfully.' });
    try {
        // Extract OriginatorConversationID
        const originatorConversationID = req.body?.OriginatorConversationID || req.query?.OriginatorConversationID;
        if (originatorConversationID) {
            await handleReversalTimeout(originatorConversationID as string);
        } else {
            console.error('M-Pesa Reversal Timeout handler: Could not extract OriginatorConversationID from request.');
        }
    } catch (error: any) {
        console.error('Error processing M-Pesa Reversal Timeout callback in controller:', error);
    }
};

/**
 * Handles Pesapal IPN callbacks.
 * Endpoint: /api/payments/pesapal/callback
 */
export const handlePesapalCallback = async (req: Request, res: Response): Promise<void> => {
    console.log('Received Pesapal IPN:', req.query);
    const transactionTrackingId = req.query.pesapal_transaction_tracking_id;
    const notificationType = req.query.pesapal_notification_type;
    res.status(200).send(`pesapal_notification_type=${notificationType}&pesapal_transaction_tracking_id=${transactionTrackingId}`);
};

/**
 * Handles T-Kash callbacks.
 * Endpoint: /api/payments/tkash/callback
 */
export const handleTkashCallback = async (req: Request, res: Response): Promise<void> => {
    console.log('Received T-Kash Callback:', req.body);
    res.status(200).json({ message: 'T-Kash Callback received' });
};

/**
 * Handles iPay callbacks.
 * Endpoint: /api/payments/ipay/callback
 */
export const handleIpayCallback = async (req: Request, res: Response): Promise<void> => {
    console.log('Received iPay Callback:', req.body);
    res.status(200).json({ message: 'iPay Callback received' });
};

/**
 * Handles DPO callbacks.
 * Endpoint: /api/payments/dpo/callback
 */
export const handleDpoCallback = async (req: Request, res: Response): Promise<void> => {
    console.log('Received DPO Callback:', req.body);
    res.status(200).json({ message: 'DPO Callback received' });
};

/**
 * Handles JamboPay callbacks.
 * Endpoint: /api/payments/jambopay/callback
 */
export const handleJambopayCallback = async (req: Request, res: Response): Promise<void> => {
    console.log('Received JamboPay Callback:', req.body);
    res.status(200).json({ message: 'JamboPay Callback received' });
};

// --- Webhook Validation Helpers ---

const validateWebhookSecret = (req: Request): boolean => {
    const providedSecret = req.headers['x-webhook-secret'];
    return providedSecret === paymentSettings.webhookSecret;
};

// Fix: Use RequestWithRawBody type
const validateHmacSignature = (req: RequestWithRawBody, secret: string): boolean => {
    const providedSignature = req.headers['x-hub-signature-256'] as string; // Example header (like GitHub/Facebook)
    if (!providedSignature || !req.rawBody) { // req.rawBody needs middleware
        console.warn('HMAC validation failed: Missing signature or rawBody.');
        return false;
    }
    const [algo, signature] = providedSignature.split('=');
    if (algo !== 'sha256') {
        console.warn(`HMAC validation failed: Unsupported algorithm '${algo}'.`);
        return false; // Only support sha256
    }

    try {
        const expectedSignature = crypto.createHmac('sha256', secret)
            .update(req.rawBody) // Use the raw buffer
            .digest('hex');

        return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
    } catch (error) {
        console.error('Error during HMAC signature verification:', error);
        return false;
    }
};
