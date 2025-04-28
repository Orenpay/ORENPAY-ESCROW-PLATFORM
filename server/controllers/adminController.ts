// server/controllers/adminController.ts
import { Request, Response } from 'express';
import { findOrderById, updateOrderStatus, findOrdersByStatus, OrderStatus, Order } from '../models/Order'; // Added OrderStatus and Order
import { createTransaction, updateTransactionDetails, findTransactionByProviderRef, findTransactionsByOrderId } from '../models/Transaction'; // Added findTransactionsByOrderId
import { sendSmsNotification } from '../services/notificationService';
import { findUserById } from '../models/User';
import { initiateB2CPayment, initiateMpesaReversal } from '../services/mpesa'; // Added initiateMpesaReversal

/**
 * Gets all orders currently in 'disputed' status.
 * Requires admin privileges.
 */
export const getDisputedOrders = async (req: Request, res: Response): Promise<void> => {
    try {
        const disputedOrders = await findOrdersByStatus('disputed');
        res.status(200).json(disputedOrders);
    } catch (error) {
        console.error('Error fetching disputed orders:', error);
        res.status(500).json({ message: 'Internal server error while fetching disputed orders.' });
    }
};

/**
 * Allows an admin to resolve a dispute by releasing funds to the seller.
 * Requires admin privileges.
 */
export const resolveDisputeReleaseFunds = async (req: Request, res: Response): Promise<void> => {
    const orderId = parseInt(req.params.id, 10);
    const adminUser = req.user; // Populated by auth middleware

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    console.log(`Admin ${adminUser?.id} attempting to resolve dispute for Order ${orderId} by releasing funds.`);

    let order; // Define order here to use in catch block if needed

    try {
        order = await findOrderById(orderId); // Assign to outer scope variable
        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.status !== 'disputed') {
            res.status(400).json({ message: `Order status is '${order.status}', not 'disputed'. Cannot resolve.` });
            return;
        }

        const seller = await findUserById(order.seller_id);
        if (!seller || !seller.phone_number) {
            console.error(`Seller ${order.seller_id} details or phone number not found for payout.`);
            await createTransaction({
                order_id: orderId,
                user_id: adminUser!.id!,
                provider: 'system_error',
                amount: order.amount,
                status: 'failed',
                description: `Admin ${adminUser!.id!} attempted fund release, but seller phone number is missing.`
            });
            res.status(500).json({ message: 'Cannot process release: Seller phone number missing.' });
            return;
        }

        let payoutInitiationResult: any;
        let payoutInitiationStatus: 'initiated' | 'failed' | 'skipped' = 'skipped';
        let payoutInitiationDetails = 'Payout not attempted or not applicable for this payment method.';
        let orderStatusAfterInitiation: OrderStatus = 'disputed'; // Default to keeping disputed
        let payoutTransactionProvider: string | null = null;
        let payoutTransactionRef: string | undefined = undefined;
        let notificationMessageBuyer = '';
        let notificationMessageSeller = '';

        // --- Initiate Payout based on original payment method ---
        if (order.payment_method === 'mpesa') {
            payoutTransactionProvider = 'mpesa_b2c';
            try {
                console.log(`Initiating M-Pesa B2C payout for Order ${orderId} to seller ${seller.id} (${seller.phone_number})`);
                payoutInitiationResult = await initiateB2CPayment(
                    seller.phone_number!,
                    order.amount,
                    `Payout for Order #${orderId} (Dispute Resolved)`
                );

                if (payoutInitiationResult && payoutInitiationResult.ResponseCode === '0') {
                    payoutInitiationStatus = 'initiated';
                    orderStatusAfterInitiation = 'processing_payout'; // Set status to processing
                    payoutTransactionRef = payoutInitiationResult.OriginatorConversationID; // Store this ID
                    payoutInitiationDetails = `M-Pesa B2C initiated successfully. OriginatorConversationID: ${payoutTransactionRef}. Waiting for result callback.`;
                    console.log(payoutInitiationDetails);

                    notificationMessageSeller = `Admin resolved the dispute for Order #${orderId}. Funds (KES ${order.amount}) are being processed for release to your M-Pesa account. Ref: ${payoutTransactionRef}`;
                    notificationMessageBuyer = `Admin resolved the dispute for Order #${orderId}. Funds are being processed for release to the seller.`;

                } else {
                    payoutInitiationStatus = 'failed';
                    orderStatusAfterInitiation = 'disputed'; // Keep disputed if initiation fails
                    payoutInitiationDetails = `M-Pesa B2C initiation failed: ${payoutInitiationResult?.ResponseDescription || 'Unknown error'}`;
                    console.error(`M-Pesa B2C initiation failed for Order ${orderId}:`, payoutInitiationResult);

                    notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId}, but M-Pesa payout initiation failed: ${payoutInitiationResult?.ResponseDescription || 'Unknown error'}. Please contact support.`;
                    notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId}, but payout initiation failed. The order remains disputed. Please contact support.`;
                }
            } catch (payoutError: any) {
                payoutInitiationStatus = 'failed';
                orderStatusAfterInitiation = 'disputed'; // Keep disputed on error
                payoutInitiationDetails = `M-Pesa B2C initiation threw an error: ${payoutError.message}`;
                console.error(`Error during M-Pesa B2C initiation for Order ${orderId}:`, payoutError);

                notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId}, but an error occurred during M-Pesa payout initiation: ${payoutError.message}. Please contact support.`;
                notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId}, but an error occurred during payout initiation. The order remains disputed. Please contact support.`;
            }
        } else if (order.payment_method === 'airtel') {
            payoutTransactionProvider = 'airtel_payout';
            payoutInitiationStatus = 'skipped';
            orderStatusAfterInitiation = 'disputed';
            payoutInitiationDetails = 'Airtel Money disbursement not implemented. Manual action required.';
            console.warn(`TODO: Implement Airtel Money disbursement for Order ${orderId}`);
            notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId}, but automated Airtel payout is not yet implemented. Please contact support for manual release.`;
            notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId}, but automated payout is not available for this method. The order remains disputed pending manual action.`;
        } else if (order.payment_method === 'equity') {
            payoutTransactionProvider = 'equity_payout';
            payoutInitiationStatus = 'skipped';
            orderStatusAfterInitiation = 'disputed';
            payoutInitiationDetails = 'Equity Bank payout not implemented. Manual action required.';
            console.warn(`TODO: Implement Equity Bank payout for Order ${orderId}`);
            notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId}, but automated Equity payout is not yet implemented. Please contact support for manual release.`;
            notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId}, but automated payout is not available for this method. The order remains disputed pending manual action.`;
        } else {
            payoutTransactionProvider = `${order.payment_method}_payout`; // Generic provider name
            payoutInitiationStatus = 'skipped';
            orderStatusAfterInitiation = 'disputed';
            payoutInitiationDetails = `Automated payout for '${order.payment_method}' not implemented. Manual action required.`;
            console.warn(payoutInitiationDetails);
            notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId}, but automated payout for ${order.payment_method} is not yet implemented. Please contact support for manual release.`;
            notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId}, but automated payout is not available for this method. The order remains disputed pending manual action.`;
        }

        let updatedOrder: Order | null = order; // Start with the original order data
        if (order.status !== orderStatusAfterInitiation) {
            updatedOrder = await updateOrderStatus(orderId, orderStatusAfterInitiation);
            if (!updatedOrder) {
                console.error(`CRITICAL: Failed to update order ${orderId} status to ${orderStatusAfterInitiation} after payout attempt.`);
                updatedOrder = { ...order, status: orderStatusAfterInitiation };
            }
        }

        await createTransaction({
            order_id: orderId,
            user_id: adminUser!.id!,
            provider: payoutTransactionProvider || 'system',
            amount: order.amount,
            status: payoutInitiationStatus === 'initiated' ? 'pending' : (payoutInitiationStatus === 'failed' ? 'failed' : 'skipped'),
            provider_ref: payoutTransactionRef,
            description: `Admin ${adminUser!.id!} resolved dispute: Release funds. Payout initiation status: ${payoutInitiationStatus}. Details: ${payoutInitiationDetails}`
        });

        const buyer = await findUserById(order.buyer_id);
        if (buyer?.phone_number && notificationMessageBuyer) {
            sendSmsNotification(buyer.phone_number, notificationMessageBuyer);
        }
        if (seller.phone_number && notificationMessageSeller) {
            sendSmsNotification(seller.phone_number, notificationMessageSeller);
        }

        if (payoutInitiationStatus === 'initiated') {
            res.status(200).json({ message: 'Dispute resolution initiated. Payout processing started.', order: updatedOrder });
        } else if (payoutInitiationStatus === 'failed') {
            res.status(500).json({ message: `Dispute resolution attempted, but payout initiation failed: ${payoutInitiationDetails}`, order: updatedOrder });
        } else {
            res.status(422).json({ message: `Dispute resolution attempted, but automated payout skipped: ${payoutInitiationDetails}`, order: updatedOrder });
        }

    } catch (error: any) {
        console.error(`Error resolving dispute (release funds) for Order ${order?.id || orderId}:`, error);
        if (order) {
            await createTransaction({
                order_id: order.id!,
                user_id: adminUser?.id || 0,
                provider: 'system_error',
                amount: order.amount || 0,
                status: 'failed',
                description: `Unexpected error during dispute resolution (release funds): ${error.message}`
            }).catch(logErr => console.error("Failed to log error transaction:", logErr));
        }
        res.status(500).json({ message: 'Internal server error while resolving dispute.' });
    }
};

/**
 * Allows an admin to resolve a dispute by refunding the buyer.
 * Requires admin privileges.
 * NOTE: This needs significant work to implement actual refund provider APIs.
 */
export const resolveDisputeRefundBuyer = async (req: Request, res: Response): Promise<void> => {
    const orderId = parseInt(req.params.id, 10);
    const adminUser = req.user; // Populated by auth middleware

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    console.log(`Admin ${adminUser?.id} attempting to resolve dispute for Order ${orderId} by refunding buyer.`);

    let order; // Define order here for use in catch block

    try {
        order = await findOrderById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.status !== 'disputed') {
            res.status(400).json({ message: `Order status is '${order.status}', not 'disputed'. Cannot resolve.` });
            return;
        }

        const buyer = await findUserById(order.buyer_id);
        if (!buyer) {
            console.error(`Buyer ${order.buyer_id} details not found for refund.`);
            await createTransaction({
                order_id: orderId,
                user_id: adminUser!.id!,
                provider: 'system_error',
                amount: order.amount,
                status: 'failed',
                description: `Admin ${adminUser!.id!} attempted refund, but buyer details are missing.`
            });
            res.status(500).json({ message: 'Cannot process refund: Buyer details missing.' });
            return;
        }

        let refundInitiationStatus: 'initiated' | 'failed' | 'skipped' = 'skipped';
        let refundInitiationDetails = 'Refund not attempted or not applicable for this payment method.';
        let orderStatusAfterInitiation: OrderStatus = 'disputed'; // Default to keeping disputed
        let refundTransactionProvider: string | null = null;
        let refundTransactionRef: string | undefined = undefined;
        let notificationMessageBuyer = '';
        let notificationMessageSeller = '';

        // --- Initiate Refund based on original payment method ---
        if (order.payment_method === 'mpesa') {
            refundTransactionProvider = 'mpesa_reversal';
            try {
                // Find the original successful M-Pesa payment transaction
                const paymentTransactions = await findTransactionsByOrderId(orderId);
                const originalPayment = paymentTransactions.find(
                    tx => tx.provider === 'mpesa' && tx.status === 'success' && tx.provider_transaction_id
                );

                if (!originalPayment || !originalPayment.provider_transaction_id) {
                    throw new Error('Original successful M-Pesa payment transaction ID not found.');
                }

                console.log(`Initiating M-Pesa Reversal for Order ${orderId}, Original TxID: ${originalPayment.provider_transaction_id}`);
                const reversalResult = await initiateMpesaReversal(
                    originalPayment.provider_transaction_id,
                    order.amount,
                    `Refund for Order #${orderId} (Dispute Resolved)`
                );

                // Check reversal initiation response
                if (reversalResult && reversalResult.ResponseCode === '0') {
                    refundInitiationStatus = 'initiated';
                    orderStatusAfterInitiation = 'processing_refund'; // Set status to processing
                    refundTransactionRef = reversalResult.OriginatorConversationID; // Store this ID
                    refundInitiationDetails = `M-Pesa Reversal initiated successfully. OriginatorConversationID: ${refundTransactionRef}. Waiting for result callback.`;
                    console.log(refundInitiationDetails);

                    notificationMessageBuyer = `Admin resolved the dispute for Order #${orderId}. A refund (KES ${order.amount}) is being processed back to your M-Pesa account. Ref: ${refundTransactionRef}`;
                    notificationMessageSeller = `Admin resolved the dispute for Order #${orderId} in favor of the buyer. A refund is being processed.`;
                } else {
                    refundInitiationStatus = 'failed';
                    orderStatusAfterInitiation = 'disputed'; // Keep disputed if initiation fails
                    refundInitiationDetails = `M-Pesa Reversal initiation failed: ${reversalResult?.ResponseDescription || 'Unknown error'}`;
                    console.error(`M-Pesa Reversal initiation failed for Order ${orderId}:`, reversalResult);

                    notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but M-Pesa reversal initiation failed: ${reversalResult?.ResponseDescription || 'Unknown error'}. Please contact support.`;
                    notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but reversal initiation failed. The order remains disputed. Please contact support.`;
                }

            } catch (refundError: any) {
                refundInitiationStatus = 'failed';
                orderStatusAfterInitiation = 'disputed';
                refundInitiationDetails = `Error during M-Pesa refund initiation attempt: ${refundError.message}`;
                console.error(refundInitiationDetails);
                notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but an error occurred: ${refundError.message}. Please contact support.`;
                notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but an error occurred. The order remains disputed. Please contact support.`;
            }

        } else {
            // Handle other payment methods - Assume manual/skipped
            refundTransactionProvider = `${order.payment_method}_refund`;
            refundInitiationStatus = 'skipped';
            orderStatusAfterInitiation = 'disputed';
            refundInitiationDetails = `Automated refund for '${order.payment_method}' not implemented. Manual action required.`;
            console.warn(refundInitiationDetails);
            notificationMessageBuyer = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but automated refund for ${order.payment_method} is not yet implemented. Please contact support.`;
            notificationMessageSeller = `Admin attempted to resolve the dispute for Order #${orderId} via refund, but automated refund is not available for this method. The order remains disputed pending manual action.`;
        }

        // --- Update Order Status and Log Transaction ---
        let updatedOrder: Order | null = order;
        // Update DB only if the status needs changing
        if (order.status !== orderStatusAfterInitiation) {
            updatedOrder = await updateOrderStatus(orderId, orderStatusAfterInitiation);
            if (!updatedOrder) {
                console.error(`CRITICAL: Failed to update order ${orderId} status to ${orderStatusAfterInitiation} after refund attempt.`);
                updatedOrder = { ...order, status: orderStatusAfterInitiation };
            }
        }

        // Log the admin action and refund *initiation* attempt
        await createTransaction({
            order_id: orderId,
            user_id: adminUser!.id!,
            provider: refundTransactionProvider || 'system',
            amount: order.amount, // Log the amount intended for refund
            status: refundInitiationStatus === 'initiated' ? 'pending' : (refundInitiationStatus === 'failed' ? 'failed' : 'skipped'),
            provider_ref: refundTransactionRef, // Store OriginatorConversationID if initiated
            description: `Admin ${adminUser!.id!} resolved dispute: Refund buyer. Refund initiation status: ${refundInitiationStatus}. Details: ${refundInitiationDetails}`
        });

        // --- Send Notifications ---
        if (buyer.phone_number && notificationMessageBuyer) {
            sendSmsNotification(buyer.phone_number, notificationMessageBuyer);
        }
        const seller = await findUserById(order.seller_id);
        if (seller?.phone_number && notificationMessageSeller) {
            sendSmsNotification(seller.phone_number, notificationMessageSeller);
        }

        // Respond to the admin API request based on initiation outcome
        if (refundInitiationStatus === 'initiated') {
            res.status(200).json({ message: 'Dispute resolution initiated. Refund processing started.', order: updatedOrder });
        } else if (refundInitiationStatus === 'failed') {
            res.status(500).json({ message: `Dispute resolution attempted (refund), but initiation failed: ${refundInitiationDetails}`, order: updatedOrder });
        } else { // Skipped
            res.status(422).json({ message: `Dispute resolution attempted (refund), but automated refund skipped: ${refundInitiationDetails}`, order: updatedOrder });
        }

    } catch (error: any) {
        console.error(`Error resolving dispute (refund buyer) for Order ${order?.id || orderId}:`, error);
        if (order) {
            await createTransaction({
                order_id: order.id!,
                user_id: adminUser?.id || 0,
                provider: 'system_error',
                amount: order.amount || 0,
                status: 'failed',
                description: `Unexpected error during dispute resolution (refund buyer): ${error.message}`
            }).catch(logErr => console.error("Failed to log error transaction:", logErr));
        }
        res.status(500).json({ message: 'Internal server error while resolving dispute.' });
    }
};
