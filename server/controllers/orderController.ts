import { Request, Response } from 'express';
import { createOrder, findOrderById, updateOrderStatus, findOrdersByUserId, OrderStatus, findTransactionsByOrderId } from '../models/Order';
import { createTransaction, updateTransactionDetails } from '../models/Transaction';
import { findUserById } from '../models/User';
import { initiateStkPush } from '../services/mpesa';
import { sendSmsNotification } from '../services/notificationService'; // Import notification service

/**
 * Creates a new order and initiates payment.
 * Requires authentication (Buyer role enforced by route middleware).
 */
export const createNewOrder = async (req: Request, res: Response): Promise<void> => {
    const buyer = req.user!;
    const { seller_id, item_description, amount, payment_method } = req.body;

    if (!seller_id || !item_description || !amount || !payment_method) {
        res.status(400).json({ message: 'Seller ID, item description, amount, and payment method are required.' });
        return;
    }

    const supportedPaymentMethods = ['mpesa', 'airtel', 'equity'];
    if (!supportedPaymentMethods.includes(payment_method.toLowerCase())) {
        res.status(400).json({ message: `Unsupported payment method: ${payment_method}` });
        return;
    }

    const buyerDetails = await findUserById(buyer.id!);
    if (!buyerDetails || !buyerDetails.phone_number) {
        res.status(400).json({ message: 'Buyer phone number is required for this payment method and is missing.' });
        return;
    }

    let newOrder;
    let initialTransaction;

    try {
        const orderInput = {
            buyer_id: buyer.id!,
            seller_id,
            item_description,
            amount,
            payment_method
        };
        newOrder = await createOrder(orderInput);

        initialTransaction = await createTransaction({
            order_id: newOrder.id!,
            user_id: buyer.id!,
            provider: payment_method,
            amount: amount,
            status: 'pending',
            description: `Order created. Initiating ${payment_method} payment.`
        });

        let paymentInitiationResult;
        let initiationDetails: { provider_ref?: string; description?: string } = {};

        console.log(`Initiating ${payment_method} payment for order ${newOrder.id} amount ${amount}...`);
        switch (payment_method.toLowerCase()) {
            case 'mpesa':
                paymentInitiationResult = await initiateStkPush(newOrder.id!, buyerDetails.phone_number, amount);
                initiationDetails.provider_ref = paymentInitiationResult?.CheckoutRequestID;
                initiationDetails.description = `M-Pesa STK Push initiated. CheckoutRequestID: ${initiationDetails.provider_ref || 'N/A'}`;
                break;
            case 'airtel':
                console.warn('Airtel payment initiation not implemented yet.');
                initiationDetails.description = 'Airtel payment initiation requested (not implemented).';
                break;
            case 'equity':
                console.warn('Equity payment initiation not implemented yet.');
                initiationDetails.description = 'Equity payment initiation requested (not implemented).';
                break;
            default:
                throw new Error('Invalid payment method for initiation.');
        }

        await updateTransactionDetails(initialTransaction.id!, 'pending', initiationDetails);

        // --- Send Notification to Seller --- 
        const sellerNotification = `New Order #${newOrder.id} created by buyer ${buyer.id}. Item: ${item_description}. Amount: KES ${amount}. Awaiting payment via ${payment_method}.`;
        sendSmsNotification(seller_id, sellerNotification);

        res.status(201).json({ order: newOrder, payment_status: 'initiated', transaction_id: initialTransaction.id });

    } catch (error: any) {
        console.error(`Error during order creation or payment initiation:`, error);

        if (initialTransaction && initialTransaction.id) {
            try {
                await updateTransactionDetails(initialTransaction.id, 'failed', {
                    description: `Payment initiation failed: ${error.message}`
                });
            } catch (updateError) {
                console.error('Failed to update transaction log after payment initiation error:', updateError);
            }
        }

        const responsePayload = {
            message: 'Failed to create order or initiate payment.',
            error: error.message,
            order: newOrder,
            payment_status: 'failed'
        };
        res.status(500).json(responsePayload);
    }
};

/**
 * Gets details of a specific order.
 * Requires authentication. User must be buyer, seller, or admin.
 */
export const getOrderDetails = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    const orderId = parseInt(req.params.id, 10);

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    if (!user) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        const order = await findOrderById(orderId);

        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.buyer_id !== user.id && order.seller_id !== user.id) {
            res.status(403).json({ message: 'Forbidden: You do not have permission to view this order.' });
            return;
        }

        const transactions = await findTransactionsByOrderId(orderId);

        res.status(200).json({ order, transactions });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Internal server error while fetching order details.' });
    }
};

/**
 * Gets orders for the authenticated user (either as buyer or seller).
 * Requires authentication.
 */
export const getUserOrders = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    if (!user) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        let orders = [];
        if (user.role === 'buyer' || user.role === 'seller') {
            orders = await findOrdersByUserId(user.id!, user.role);
        } else if (user.role === 'business') {
            orders = await findOrdersByUserId(user.id!, 'seller');
        }

        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Internal server error while fetching orders.' });
    }
};

/**
 * Allows the buyer to confirm delivery of an order, triggering fund release.
 * Requires authentication (Buyer role enforced by route middleware).
 */
export const confirmOrderDelivery = async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const orderId = parseInt(req.params.id, 10);

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    try {
        const order = await findOrderById(orderId);

        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.buyer_id !== user.id) {
            res.status(403).json({ message: 'Forbidden: Only the buyer can confirm delivery.' });
            return;
        }

        if (order.status !== 'shipped') {
            res.status(400).json({ message: `Cannot confirm delivery for order with status: ${order.status}. Must be 'shipped'.` });
            return;
        }

        const updatedOrder = await updateOrderStatus(orderId, 'completed');
        if (!updatedOrder) {
            throw new Error('Failed to update order status to completed.');
        }

        try {
            console.log(`Initiating fund release for order ${orderId} to seller ${order.seller_id}...`);
            console.warn('Fund release logic not implemented yet.');

            await createTransaction({
                order_id: orderId,
                user_id: user.id!,
                provider: 'system',
                amount: order.amount,
                status: 'success',
                description: `Buyer confirmed delivery. Funds released/release initiated for seller ${order.seller_id}.`
            });

            // --- Send Notification to Seller --- 
            const sellerNotification = `Buyer has confirmed delivery for Order #${orderId}. Funds (KES ${order.amount}) have been released or are being processed.`;
            sendSmsNotification(order.seller_id, sellerNotification);

        } catch (releaseError: any) {
            console.error(`Fund release failed for order ${orderId}:`, releaseError);
            await createTransaction({
                order_id: orderId,
                user_id: user.id!,
                provider: 'system',
                amount: order.amount,
                status: 'failed',
                description: `Fund release failed: ${releaseError.message}`
            });

            // --- Send Notification to Seller (about failure) --- 
            const sellerFailureNotification = `Buyer confirmed delivery for Order #${orderId}, but automated fund release failed. Please contact support.`;
            sendSmsNotification(order.seller_id, sellerFailureNotification);

            res.status(200).json({ 
                order: updatedOrder, 
                release_status: 'failed', 
                message: 'Delivery confirmed, but automated fund release failed. Admin notified.' 
            });
            return;
        }

        res.status(200).json({ order: updatedOrder, release_status: 'initiated' });

    } catch (error) {
        console.error('Error confirming delivery:', error);
        res.status(500).json({ message: 'Internal server error while confirming delivery.' });
    }
};

/**
 * Allows the buyer or seller to raise a dispute for an order.
 * Requires authentication.
 */
export const raiseOrderDispute = async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const orderId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }
    if (!reason) {
        res.status(400).json({ message: 'Dispute reason is required.' });
        return;
    }
    if (!user) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        const order = await findOrderById(orderId);

        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.buyer_id !== user.id && order.seller_id !== user.id) {
            res.status(403).json({ message: 'Forbidden: Only the buyer or seller can raise a dispute for this order.' });
            return;
        }

        const disputableStates: OrderStatus[] = ['paid', 'shipped', 'delivered'];
        if (!order.status || !disputableStates.includes(order.status)) {
            res.status(400).json({ message: `Cannot raise dispute for order with status: ${order.status}. Must be in ${disputableStates.join(', ')}.` });
            return;
        }

        const updatedOrder = await updateOrderStatus(orderId, 'disputed');
        if (!updatedOrder) {
            throw new Error('Failed to update order status to disputed.');
        }

        await createTransaction({
            order_id: orderId,
            user_id: user.id!,
            provider: 'system',
            amount: 0,
            status: 'pending',
            description: `Dispute raised by ${user.role} (ID: ${user.id}). Reason: ${reason}`
        });

        // --- Send Notification to the other party --- 
        let partyToNotifyId: number;
        let notificationMessage: string;
        if (user.id === order.buyer_id) {
            // Buyer raised dispute, notify seller
            partyToNotifyId = order.seller_id;
            notificationMessage = `Dispute raised by the buyer for Order #${orderId}. Reason: ${reason}. Please check your dashboard.`;
        } else {
            // Seller raised dispute, notify buyer
            partyToNotifyId = order.buyer_id;
            notificationMessage = `Dispute raised by the seller for Order #${orderId}. Reason: ${reason}. Please check your dashboard.`;
        }
        sendSmsNotification(partyToNotifyId, notificationMessage);

        res.status(200).json(updatedOrder);

    } catch (error) {
        console.error('Error raising dispute:', error);
        res.status(500).json({ message: 'Internal server error while raising dispute.' });
    }
};

/**
 * Allows the seller to mark an order as shipped and optionally upload proof.
 * Requires authentication (Seller/Business role enforced by route middleware).
 */
export const markOrderAsShipped = async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const orderId = parseInt(req.params.id, 10);
    const { proof_of_delivery_url } = req.body;

    if (isNaN(orderId)) {
        res.status(400).json({ message: 'Invalid order ID.' });
        return;
    }

    try {
        const order = await findOrderById(orderId);

        if (!order) {
            res.status(404).json({ message: 'Order not found.' });
            return;
        }

        if (order.seller_id !== user.id) {
            res.status(403).json({ message: 'Forbidden: Only the seller can mark this order as shipped.' });
            return;
        }

        if (order.status !== 'paid') {
            res.status(400).json({ message: `Cannot mark order as shipped with status: ${order.status}. Must be 'paid'.` });
            return;
        }

        const updatedOrder = await updateOrderStatus(orderId, 'shipped', proof_of_delivery_url);
        if (!updatedOrder) {
            throw new Error('Failed to update order status to shipped.');
        }

        await createTransaction({
            order_id: orderId,
            user_id: user.id!,
            provider: 'system',
            amount: 0,
            status: 'success',
            description: `Order marked as shipped by seller.${proof_of_delivery_url ? ' Proof provided.' : ''}`
        });

        // --- Send Notification to Buyer --- 
        const buyerNotification = `Your Order #${orderId} has been shipped by the seller${proof_of_delivery_url ? ' (proof available)' : ''}. Please confirm delivery upon receipt.`;
        sendSmsNotification(order.buyer_id, buyerNotification);

        res.status(200).json(updatedOrder);

    } catch (error) {
        console.error('Error marking order as shipped:', error);
        res.status(500).json({ message: 'Internal server error while marking order as shipped.' });
    }
};
