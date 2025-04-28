import { Request, Response } from 'express';
import {
    createShipment,
    findShipmentById,
    findShipmentByOrderId,
    findShipmentByTrackingCode,
    updateShipmentStatus,
    ShipmentStatus
} from '../models/Shipment';
import {
    createShipmentLeg,
    findShipmentLegsByShipmentId,
    findShipmentLegById,
    updateShipmentLegStatus,
    assignAgentToLeg,
    ShipmentLegStatus
} from '../models/ShipmentLeg';
import { findOrderById } from '../models/Order';
import { findAgentById, findAgentByUserId } from '../models/Agent';
// TODO: Import notification service

// Create a shipment (usually triggered internally after order payment)
// This might be called by an order service or admin function
export const createNewShipment = async (req: Request, res: Response): Promise<void> => {
    const { order_id, pickup_location, delivery_location } = req.body;

    if (!order_id || !pickup_location || !delivery_location) {
        res.status(400).json({ message: 'Order ID, pickup location, and delivery location are required.' });
        return;
    }

    try {
        // Verify order exists
        const order = await findOrderById(order_id);
        if (!order) {
            res.status(404).json({ message: `Order with ID ${order_id} not found.` });
            return;
        }
        // Prevent creating duplicate shipments for the same order
        const existingShipment = await findShipmentByOrderId(order_id);
        if (existingShipment) {
            res.status(409).json({ message: `Shipment already exists for order ID ${order_id}.` });
            return;
        }

        const shipmentData = { order_id, pickup_location, delivery_location };
        const newShipment = await createShipment(shipmentData);

        // TODO: Potentially create the first leg automatically here or trigger assignment service

        res.status(201).json(newShipment);

    } catch (error: any) {
        console.error('Error creating shipment:', error);
         if (error.code === '23505') { // Handle unique constraint (e.g., tracking code, though unlikely here)
             res.status(409).json({ message: 'A unique constraint was violated (e.g., tracking code).' });
        } else {
            res.status(500).json({ message: 'Internal server error while creating shipment.', error: error.message });
        }
    }
};

// Get shipment details by ID
export const getShipmentDetails = async (req: Request, res: Response): Promise<void> => {
    const shipmentId = parseInt(req.params.id, 10);
    const user = req.user;

    if (isNaN(shipmentId)) {
        res.status(400).json({ message: 'Invalid shipment ID.' });
        return;
    }
     if (!user || !user.id) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        const shipment = await findShipmentById(shipmentId);
        if (!shipment) {
            res.status(404).json({ message: 'Shipment not found.' });
            return;
        }

        // Authorization: Check if user is related to the order (buyer/seller) or admin
        const order = await findOrderById(shipment.order_id);
        if (!order) {
             res.status(404).json({ message: 'Associated order not found.' }); // Should not happen ideally
            return;
        }
        if (user.role !== 'admin' && user.id !== order.buyer_id && user.id !== order.seller_id) {
             res.status(403).json({ message: 'Forbidden: You do not have permission to view this shipment.' });
            return;
        }

        // Optionally fetch legs as well
        const legs = await findShipmentLegsByShipmentId(shipmentId);

        res.status(200).json({ shipment, legs });

    } catch (error) {
        console.error('Error fetching shipment details:', error);
        res.status(500).json({ message: 'Internal server error while fetching shipment details.' });
    }
};

// Get shipment details by Tracking Code (Publicly accessible?)
export const trackShipmentByCode = async (req: Request, res: Response): Promise<void> => {
    const trackingCode = req.params.trackingCode;

    if (!trackingCode) {
        res.status(400).json({ message: 'Tracking code is required.' });
        return;
    }

    try {
        const shipment = await findShipmentByTrackingCode(trackingCode);
        if (!shipment) {
            res.status(404).json({ message: 'Shipment not found with this tracking code.' });
            return;
        }

        // Decide what details to expose publicly
        const publicShipmentDetails = {
            status: shipment.status,
            estimated_time: shipment.estimated_time,
            // Potentially add current location if available and safe to share
        };

        // Optionally fetch and filter leg details
        const legs = await findShipmentLegsByShipmentId(shipment.id!);
        const publicLegs = legs.map(leg => ({
            leg_number: leg.leg_number,
            status: leg.status,
            pickup_location: leg.pickup_location, // Maybe mask precise locations?
            delivery_location: leg.delivery_location,
            actual_delivery_time: leg.actual_delivery_time
        }));

        res.status(200).json({ shipment: publicShipmentDetails, legs: publicLegs });

    } catch (error) {
        console.error('Error tracking shipment by code:', error);
        res.status(500).json({ message: 'Internal server error while tracking shipment.' });
    }
};

// --- Shipment Leg Management ---

// Create a new leg for a shipment (Likely admin/system function)
export const addShipmentLeg = async (req: Request, res: Response): Promise<void> => {
    const shipmentId = parseInt(req.params.shipmentId, 10);
    const {
        leg_number,
        agent_id, // Optional initially
        pickup_location,
        delivery_location,
        estimated_pickup_time,
        estimated_delivery_time
    } = req.body;

    if (isNaN(shipmentId)) {
        res.status(400).json({ message: 'Invalid shipment ID.' });
        return;
    }
    if (!leg_number || !pickup_location || !delivery_location) {
        res.status(400).json({ message: 'Leg number, pickup location, and delivery location are required.' });
        return;
    }

    try {
        // Verify shipment exists
        const shipment = await findShipmentById(shipmentId);
        if (!shipment) {
            res.status(404).json({ message: `Shipment with ID ${shipmentId} not found.` });
            return;
        }

        // TODO: Add validation - leg_number should be sequential?

        const legData = {
            shipment_id: shipmentId,
            leg_number,
            agent_id,
            pickup_location,
            delivery_location,
            estimated_pickup_time,
            estimated_delivery_time
        };

        const newLeg = await createShipmentLeg(legData);
        res.status(201).json(newLeg);

    } catch (error: any) {
        console.error('Error adding shipment leg:', error);
         if (error.code === '23505') { // Handle unique constraint (shipment_id, leg_number)
             res.status(409).json({ message: `Leg number ${leg_number} already exists for shipment ${shipmentId}.` });
        } else {
            res.status(500).json({ message: 'Internal server error while adding shipment leg.', error: error.message });
        }
    }
};

// Assign an agent to a shipment leg (Admin/System function)
export const assignAgentToShipmentLeg = async (req: Request, res: Response): Promise<void> => {
    const legId = parseInt(req.params.legId, 10);
    const { agent_id } = req.body;

    if (isNaN(legId)) {
        res.status(400).json({ message: 'Invalid leg ID.' });
        return;
    }
    if (!agent_id || typeof agent_id !== 'number') {
        res.status(400).json({ message: 'Agent ID is required.' });
        return;
    }

    try {
        // Verify leg exists
        const leg = await findShipmentLegById(legId);
        if (!leg) {
            res.status(404).json({ message: `Shipment leg with ID ${legId} not found.` });
            return;
        }
        // Verify agent exists
        const agent = await findAgentById(agent_id);
        if (!agent) {
            res.status(404).json({ message: `Agent with ID ${agent_id} not found.` });
            return;
        }

        // TODO: Check if agent is available/suitable?

        const updatedLeg = await assignAgentToLeg(legId, agent_id);
        if (!updatedLeg) {
            throw new Error('Failed to assign agent to leg.');
        }

        // Update overall shipment status if this is the first assignment
        if (leg.leg_number === 1) {
            await updateShipmentStatus(leg.shipment_id, 'assigned', agent_id, 1);
        }

        // TODO: Notify assigned agent

        res.status(200).json(updatedLeg);

    } catch (error) {
        console.error('Error assigning agent to leg:', error);
        res.status(500).json({ message: 'Internal server error while assigning agent.' });
    }
};

// Update shipment leg status (Agent action)
export const updateLegStatus = async (req: Request, res: Response): Promise<void> => {
    const legId = parseInt(req.params.legId, 10);
    const { status, proof_url, notes } = req.body;
    const user = req.user; // Authenticated agent

    if (isNaN(legId)) {
        res.status(400).json({ message: 'Invalid leg ID.' });
        return;
    }
    if (!status) {
        res.status(400).json({ message: 'Status is required.' });
        return;
    }
    if (!user || !user.id) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    const validStatuses: ShipmentLegStatus[] = ['accepted', 'in_transit', 'delivered_to_hub', 'delivered_to_recipient', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
    }

    try {
        const leg = await findShipmentLegById(legId);
        if (!leg) {
            res.status(404).json({ message: `Shipment leg with ID ${legId} not found.` });
            return;
        }

        // Authorization: Check if the authenticated user is the assigned agent for this leg
        const agentProfile = await findAgentByUserId(user.id);
        if (!agentProfile || agentProfile.id !== leg.agent_id) {
            res.status(403).json({ message: 'Forbidden: You are not the assigned agent for this shipment leg.' });
            return;
        }

        // TODO: Add state transition validation (e.g., cannot go from 'pending' to 'delivered')

        const updatedLeg = await updateShipmentLegStatus(legId, status, proof_url, notes);
        if (!updatedLeg) {
            throw new Error('Failed to update shipment leg status.');
        }

        // Update overall shipment status based on leg completion
        let overallShipmentStatus: ShipmentStatus | null = null;
        let nextLegAgentId: number | null | undefined = undefined;
        let nextLegNumber: number | undefined = undefined;

        if (status === 'delivered_to_recipient') {
            overallShipmentStatus = 'delivered';
        } else if (status === 'delivered_to_hub') {
            // Find the next leg to determine the next status/agent
            const allLegs = await findShipmentLegsByShipmentId(leg.shipment_id);
            const nextLeg = allLegs.find(l => l.leg_number === leg.leg_number + 1);
            if (nextLeg) {
                overallShipmentStatus = nextLeg.agent_id ? 'assigned' : 'at_hub'; // Or 'pending_assignment' if no agent yet?
                nextLegAgentId = nextLeg.agent_id;
                nextLegNumber = nextLeg.leg_number;
            } else {
                // This was the last leg, but delivered to hub? Error state?
                console.warn(`Leg ${legId} delivered to hub, but no next leg found for shipment ${leg.shipment_id}`);
                overallShipmentStatus = 'at_hub'; // Or maybe 'failed'?
            }
        } else if (status === 'in_transit') {
            overallShipmentStatus = 'in_transit';
        } else if (status === 'failed' || status === 'cancelled') {
            overallShipmentStatus = status; // Match overall status
        }

        if (overallShipmentStatus) {
            await updateShipmentStatus(leg.shipment_id, overallShipmentStatus, nextLegAgentId, nextLegNumber);
            // TODO: Notify relevant parties (buyer, seller, next agent if applicable)
        }

        res.status(200).json(updatedLeg);

    } catch (error) {
        console.error('Error updating shipment leg status:', error);
        res.status(500).json({ message: 'Internal server error while updating leg status.' });
    }
};
