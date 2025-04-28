-- Add an index to the phone_number column in the users table for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);