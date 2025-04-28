import { Request, Response } from 'express';
import {
    createAgent,
    findAgentById,
    findAgentByUserId,
    updateAgentStatusLocation,
    updateAgentKycStatus,
    findAvailableAgentsNearLocation,
    AgentStatus,
    KycStatus
} from '../models/Agent';
import { findUserById } from '../models/User';

// Placeholder for agent registration - likely linked to user creation or an admin function
export const registerAgentProfile = async (req: Request, res: Response): Promise<void> => {
    // This might be better handled by an admin or during user signup if role is agent
    const user = req.user; // Assuming user is authenticated and ID is available
    const { name, phone, routes_covered, is_sacco, is_rider } = req.body;

    if (!user || !user.id) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    if (!name || !phone || typeof is_sacco !== 'boolean' || typeof is_rider !== 'boolean') {
        res.status(400).json({ message: 'Name, phone, is_sacco, and is_rider are required.' });
        return;
    }

    // Optional: Add validation for phone format, etc.

    try {
        // Check if user already has an agent profile
        const existingAgent = await findAgentByUserId(user.id);
        if (existingAgent) {
            res.status(409).json({ message: 'User already has an agent profile.' });
            return;
        }

        const agentData = {
            user_id: user.id,
            name,
            phone,
            routes_covered,
            is_sacco,
            is_rider
        };

        const newAgent = await createAgent(agentData);
        res.status(201).json(newAgent);

    } catch (error: any) {
        console.error('Error registering agent profile:', error);
        // Handle potential unique constraint errors (e.g., phone number)
        if (error.code === '23505') { // PostgreSQL unique violation code
             res.status(409).json({ message: 'Phone number already associated with another agent.' });
        } else {
            res.status(500).json({ message: 'Internal server error while registering agent profile.', error: error.message });
        }
    }
};

// Get agent profile (for the authenticated agent user)
export const getAgentProfile = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    if (!user || !user.id) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        const agent = await findAgentByUserId(user.id);
        if (!agent) {
            res.status(404).json({ message: 'Agent profile not found for this user.' });
            return;
        }
        res.status(200).json(agent);
    } catch (error) {
        console.error('Error fetching agent profile:', error);
        res.status(500).json({ message: 'Internal server error while fetching agent profile.' });
    }
};

// Update agent status and location (for the authenticated agent user)
export const updateAgentLocationStatus = async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    const { status, latitude, longitude } = req.body;

    if (!user || !user.id) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    if (!status || typeof latitude !== 'number' || typeof longitude !== 'number') {
        res.status(400).json({ message: 'Status, latitude, and longitude are required.' });
        return;
    }

    // Validate status
    const validStatuses: AgentStatus[] = ['available', 'busy', 'offline'];
    if (!validStatuses.includes(status)) {
        res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
    }

    try {
        const agent = await findAgentByUserId(user.id);
        if (!agent || !agent.id) {
            res.status(404).json({ message: 'Agent profile not found for this user.' });
            return;
        }

        const updatedAgent = await updateAgentStatusLocation(agent.id, status, latitude, longitude);
        if (!updatedAgent) {
            throw new Error('Failed to update agent status and location.');
        }
        res.status(200).json(updatedAgent);

    } catch (error) {
        console.error('Error updating agent status/location:', error);
        res.status(500).json({ message: 'Internal server error while updating status/location.' });
    }
};

// --- Admin functions for Agents (Example) ---

// Admin: Update agent KYC status
export const adminUpdateAgentKyc = async (req: Request, res: Response): Promise<void> => {
    const agentId = parseInt(req.params.agentId, 10);
    const { kyc_status } = req.body;

    if (isNaN(agentId)) {
        res.status(400).json({ message: 'Invalid agent ID.' });
        return;
    }

    const validStatuses: KycStatus[] = ['pending', 'verified', 'rejected'];
    if (!kyc_status || !validStatuses.includes(kyc_status)) {
        res.status(400).json({ message: `Invalid KYC status. Must be one of: ${validStatuses.join(', ')}` });
        return;
    }

    try {
        const updatedAgent = await updateAgentKycStatus(agentId, kyc_status);
        if (!updatedAgent) {
            res.status(404).json({ message: 'Agent not found or failed to update KYC status.' });
            return;
        }
        // TODO: Notify agent about KYC status change
        res.status(200).json(updatedAgent);
    } catch (error) {
        console.error('Error updating agent KYC status:', error);
        res.status(500).json({ message: 'Internal server error while updating KYC status.' });
    }
};

// Find available agents near a location (e.g., for assignment service)
export const findNearbyAvailableAgents = async (req: Request, res: Response): Promise<void> => {
    const { latitude, longitude, radius } = req.query;

    const lat = parseFloat(latitude as string);
    const lon = parseFloat(longitude as string);
    const rad = parseInt(radius as string, 10) || 5000; // Default 5km radius

    if (isNaN(lat) || isNaN(lon)) {
        res.status(400).json({ message: 'Valid latitude and longitude query parameters are required.' });
        return;
    }

    try {
        const agents = await findAvailableAgentsNearLocation(lat, lon, rad);
        res.status(200).json(agents);
    } catch (error: any) {
        console.error('Error finding nearby agents:', error);
        // Handle PostGIS specific errors if necessary
        if (error.message.includes('function st_dwithin(geometry, geography, integer) does not exist')) {
             res.status(500).json({ message: 'Server error: PostGIS extension might not be enabled or configured correctly.' });
        } else {
            res.status(500).json({ message: 'Internal server error while finding nearby agents.' });
        }
    }
};
