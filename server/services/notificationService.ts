// server/services/notificationService.ts
import AfricasTalking from 'africastalking';
import { africastalkingConfig } from '../../config/providers';
import { findUserById } from '../models/User'; // To fetch phone numbers

if (!africastalkingConfig.apiKey || !africastalkingConfig.username) {
    console.warn('Africa's Talking API Key or Username is not configured. SMS notifications will be disabled.');
}

const credentials = {
    apiKey: africastalkingConfig.apiKey!,
    username: africastalkingConfig.username!,
};

// Initialize Africa's Talking SDK
let sms: any;
if (credentials.apiKey && credentials.username) {
    const africasTalking = AfricasTalking(credentials);
    sms = africasTalking.SMS;
} else {
    // Mock SMS function if not configured
    sms = {
        send: async (options: any) => {
            console.log('--- SMS Notification (Mock) ---');
            console.log(`To: ${options.to.join(', ')}`);
            console.log(`Message: ${options.message}`);
            console.log('-----------------------------');
            return Promise.resolve({ /* Mock success response */ });
        }
    };
    console.log("Initialized Mock SMS service.");
}


/**
 * Sends an SMS notification using Africa's Talking.
 * @param recipientUserId - The ID of the user to notify.
 * @param message - The message content.
 */
export const sendSmsNotification = async (recipientUserId: number, message: string): Promise<void> => {
    if (!sms) {
        console.warn('SMS service not initialized. Cannot send SMS.');
        return;
    }

    try {
        const user = await findUserById(recipientUserId);
        if (!user || !user.phone_number) {
            console.warn(`Cannot send SMS: User ${recipientUserId} not found or has no phone number.`);
            return;
        }

        // Format phone number for Africa's Talking (e.g., +254xxxxxxxxx)
        // Assuming phone numbers are stored in a standard format that AT can use
        // Add '+' if missing, ensure country code is present
        let formattedPhoneNumber = user.phone_number;
        if (!formattedPhoneNumber.startsWith('+')) {
            // Basic check, might need more robust formatting based on stored data
            if (formattedPhoneNumber.startsWith('254')) {
                formattedPhoneNumber = `+${formattedPhoneNumber}`;
            } else if (formattedPhoneNumber.startsWith('0')) {
                 formattedPhoneNumber = `+254${formattedPhoneNumber.substring(1)}`;
            } else {
                 console.warn(`Cannot format phone number for user ${recipientUserId}: ${user.phone_number}`);
                 return; // Or handle differently
            }
        }


        const options = {
            to: [formattedPhoneNumber],
            message: message,
            // from: africastalkingConfig.shortcodeOrSenderId // Optional: Specify sender ID if configured
        };

        console.log(`Sending SMS to ${options.to[0]}: "${options.message}"`);
        const response = await sms.send(options);
        console.log('Africa's Talking SMS Response:', response);

    } catch (error: any) {
        console.error(`Error sending SMS via Africa's Talking to user ${recipientUserId}:`, error.message || error);
        // Handle specific errors if needed (e.g., insufficient balance)
    }
};

// Potential future function for email
// export const sendEmailNotification = async (recipientUserId: number, subject: string, body: string): Promise<void> => {
//     // Implementation using an email service (e.g., Nodemailer with SendGrid/Mailgun)
// };

