-- Add a unique constraint to the phone_number column in the users table
ALTER TABLE users
ADD CONSTRAINT unique_phone_number UNIQUE (phone_number);