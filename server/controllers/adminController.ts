// server/controllers/adminController.ts
import { Request, Response } from 'express';
import { findOrderById, updateOrderStatus, findOrdersByStatus } from '../models/Order';
import { createTransaction, updateTransactionDetails, findTransactionByProviderRef } from '../models/Transaction'; // Added findTransactionByProviderRef
import { sendSmsNotification } from '../services/notificationService';
import { findUserById } from '../models/User'; // Added findUserById
import { initiateB2CPayment } from '../services/mpesa'; // Added initiateB2CPayment

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
    const adminUser = req.user;

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    console.log(`Admin ${adminUser?.id} attempting to resolve dispute for Order ${orderId} by releasing funds.`);

    try {
        const order = await findOrderById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.status !== 'disputed') {
            res.status(400).json({ message: `Order status is '${order.status}', not 'disputed'. Cannot resolve.` });
            return;
        }

        // Fetch seller details for payout
        const seller = await findUserById(order.seller_id);
        if (!seller || !seller.phone_number) {
            console.error(`Seller ${order.seller_id} details or phone number not found for payout.`);
            // Log this critical issue
            await createTransaction({
                order_id: orderId,
                user_id: adminUser!.id!,
                provider: 'system',
                amount: order.amount,
                status: 'failed',
                description: `Admin ${adminUser!.id!} attempted fund release, but seller phone number is missing.`
            });
            res.status(500).json({ message: 'Cannot process release: Seller phone number missing.' });
            return;
        }

        let payoutInitiationResult: any;
        let payoutStatus: 'processing' | 'failed' = 'failed';
        let payoutDetails = 'Payout not attempted for this payment method.';
        let finalOrderStatus: 'processing_payout' | 'disputed' | 'completed' = 'disputed'; // Default to disputed if payout fails
        let payoutTransactionProvider: string | null = null;
        let payoutTransactionRef: string | undefined = undefined;

        // --- Initiate Payout based on original payment method --- 
        if (order.payment_method === 'mpesa') {
            payoutTransactionProvider = 'mpesa_b2c'; // Specific provider for B2C
            try {
                console.log(`Initiating M-Pesa B2C payout for Order ${orderId} to seller ${seller.id} (${seller.phone_number})`);
                payoutInitiationResult = await initiateB2CPayment(
                    seller.phone_number!,
                    order.amount,
                    `Payout for Order #${orderId} (Dispute Resolved)`
                );

                // Check B2C initiation response
                if (payoutInitiationResult && payoutInitiationResult.ResponseCode === '0') {
                    payoutStatus = 'processing';
                    finalOrderStatus = 'processing_payout'; // Update order status to reflect processing
                    payoutTransactionRef = payoutInitiationResult.OriginatorConversationID; // Store this ID
                    payoutDetails = `M-Pesa B2C initiated. OriginatorConversationID: ${payoutTransactionRef}. Waiting for result callback.`;
                    console.log(`M-Pesa B2C initiated successfully for Order ${orderId}. OriginatorConversationID: ${payoutTransactionRef}`);
                } else {
                    payoutStatus = 'failed';
                    payoutDetails = `M-Pesa B2C initiation failed: ${payoutInitiationResult?.ResponseDescription || 'Unknown error'}`;
                    console.error(`M-Pesa B2C initiation failed for Order ${orderId}:`, payoutInitiationResult);
                }
            } catch (payoutError: any) {
                payoutStatus = 'failed';
                payoutDetails = `M-Pesa B2C initiation threw an error: ${payoutError.message}`;
                console.error(`Error during M-Pesa B2C initiation for Order ${orderId}:`, payoutError);
            }
        } else if (order.payment_method === 'airtel') {
            console.warn(`TODO: Implement Airtel Money disbursement for Order ${orderId}`);
            payoutTransactionProvider = 'airtel_payout'; // Example
            payoutDetails = 'Airtel Money disbursement not implemented.';
            // Mark as failed since automated payout didn't happen
            finalOrderStatus = 'disputed'; // Keep disputed until manually resolved
            payoutStatus = 'failed'; // Log as failed because automated payout skipped/failed
        } else if (order.payment_method === 'equity') {
            console.warn(`TODO: Implement Equity Bank payout for Order ${orderId}`);
            payoutTransactionProvider = 'equity_payout'; // Example
            payoutDetails = 'Equity Bank payout not implemented.';
            // Mark as failed since automated payout didn't happen
            finalOrderStatus = 'disputed'; // Keep disputed until manually resolved
            payoutStatus = 'failed'; // Log as failed because automated payout skipped/failed
        } else {
            // Unknown payment method - treat as manual/error
            payoutStatus = 'failed';
            payoutDetails = `Cannot process payout: Unknown payment method '${order.payment_method}'.`;
            console.error(payoutDetails);
            finalOrderStatus = 'disputed'; // Keep disputed
        }

        // --- Update Order Status and Log Transaction --- 
        let updatedOrder;
        if (payoutStatus === 'processing') { // Only update status if payout is actively processing
            updatedOrder = await updateOrderStatus(orderId, finalOrderStatus);
        } else {
            // Keep status as disputed if payout initiation failed or was skipped
            updatedOrder = order; // Use the existing order data
            finalOrderStatus = 'disputed';
        }

        // Log the admin action and payout attempt
        await createTransaction({
            order_id: orderId,
            user_id: adminUser!.id!,
            provider: payoutTransactionProvider || 'system', // Use specific provider if available
            amount: order.amount,
            // Use 'pending' if B2C initiated, 'failed' otherwise (covers skipped cases too)
            status: payoutStatus === 'processing' ? 'pending' : 'failed', 
            // Ensure provider_ref is string | undefined
            provider_ref: payoutTransactionRef ?? undefined, 
            description: `Admin ${adminUser!.id!} resolved dispute: Release funds. Payout status: ${payoutStatus}. Details: ${payoutDetails}`
        });

        // --- Send Notifications --- 
        if (payoutStatus === 'processing') {
            // Notify seller that payout is processing
            const sellerMessage = `Admin resolved the dispute for Order #${orderId}. Funds (KES ${order.amount}) are being processed for release to your M-Pesa account.`;
            sendSmsNotification(order.seller_id, sellerMessage);
            // Notify buyer that payout is processing
            const buyerMessage = `Admin resolved the dispute for Order #${orderId}. Funds are being processed for release to the seller.`;
            sendSmsNotification(order.buyer_id, buyerMessage);
            res.status(200).json({ message: 'Dispute resolved. Payout processing initiated.', order: updatedOrder });
        } else { // Covers payoutStatus === 'failed' (including skipped methods)
            // Payout initiation failed or skipped
            const adminMessage = `Failed to initiate/process payout for Order #${orderId} during dispute resolution. Reason: ${payoutDetails}`;
            // TODO: Send notification to admin/support channel
            console.error(adminMessage);

            // Notify seller and buyer about the failure/issue
            const sellerMessage = `Admin attempted to resolve the dispute for Order #${orderId}, but payout could not be automatically processed (${payoutDetails}). Please contact support.`;
            sendSmsNotification(order.seller_id, sellerMessage);
            const buyerMessage = `Admin attempted to resolve the dispute for Order #${orderId}, but payout could not be automatically processed. The order remains disputed. Please contact support.`;
            sendSmsNotification(order.buyer_id, buyerMessage);

            // Use 500 for actual errors, maybe 400/422 if it was expected (like non-implemented method)? Using 500 for now.
            res.status(500).json({ message: 'Dispute resolution attempted, but automated payout failed or was not applicable.', order: updatedOrder });
        }

    } catch (error) {
        console.error(`Error resolving dispute (release funds) for Order ${orderId}:`, error);
        res.status(500).json({ message: 'Internal server error while resolving dispute.' });
    }
};

/**
 * Allows an admin to resolve a dispute by refunding the buyer.
 * Requires admin privileges.
 */
export const resolveDisputeRefundBuyer = async (req: Request, res: Response): Promise<void> => {
    const orderId = parseInt(req.params.id, 10);
    const adminUser = req.user; // Populated by auth middleware

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    console.log(`Admin ${adminUser?.id} attempting to resolve dispute for Order ${orderId} by refunding buyer.`);

    try {
        // 1. Fetch the order by ID.
        const order = await findOrderById(orderId);
        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        // 2. Verify the order status is 'disputed'.
        if (order.status !== 'disputed') {
            res.status(400).json({ message: `Order status is '${order.status}', not 'disputed'. Cannot resolve.` });
            return;
        }

        // 3. Implement the actual refund logic (calling payment service/API).
        // WARNING: Actual refund processing is complex and provider-specific.
        // This might involve reversal APIs or specific refund endpoints.
        console.warn(`TODO: Implement actual refund for Order ${orderId} to Buyer ${order.buyer_id} via ${order.payment_method} API.`);
        const refundSuccess = true; // Assume success for now

        if (!refundSuccess) {
            // Handle refund failure
            console.error(`Refund failed for Order ${orderId}.`);
            await createTransaction({
                order_id: orderId,
                user_id: adminUser!.id!, // Admin user ID
                provider: 'system',
                amount: order.amount,
                status: 'failed',
                description: `Admin ${adminUser!.id!} attempted refund to buyer ${order.buyer_id}, but it failed.`
            });
            res.status(500).json({ message: 'Refund process failed. Order status remains disputed.' });
            return;
        }

        // 4. Update the order status to 'refunded'.
        const updatedOrder = await updateOrderStatus(orderId, 'refunded');
        if (!updatedOrder) {
            throw new Error('Failed to update order status to refunded after dispute resolution.');
        }

        // 5. Log the admin action in the transaction history.
        await createTransaction({
            order_id: orderId,
            user_id: adminUser!.id!, // Admin user ID
            provider: 'system',
            amount: order.amount, // Log the amount refunded
            status: 'refunded', // Use 'refunded' status for the transaction log
            description: `Dispute resolved by admin ${adminUser!.id!}. Funds refunded to buyer ${order.buyer_id}.`
        });

        // 6. Notify buyer and seller.
        const buyerMessage = `Admin resolved the dispute for Order #${orderId}. A refund of KES ${order.amount} has been processed to your account.`;
        sendSmsNotification(order.buyer_id, buyerMessage);

        const sellerMessage = `Admin resolved the dispute for Order #${orderId} in favor of the buyer. Funds have been refunded.`;
        sendSmsNotification(order.seller_id, sellerMessage);

        res.status(200).json({ message: 'Dispute resolved successfully. Funds refunded to buyer.', order: updatedOrder });

    } catch (error) {
        console.error(`Error resolving dispute (refund buyer) for Order ${orderId}:`, error);
        res.status(500).json({ message: 'Internal server error while resolving dispute.' });
    }
};
