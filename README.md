🟩 ORENPAY Escrow Solutions — MVP Roadmap & Technical Specification 🧭 Project Overview OrenPay is an escrow platform for local online businesses and social media sellers in Kenya. Its purpose is to secure buyer-seller transactions for individuals and businesses without dedicated websites but who rely on platforms like Facebook, Instagram, TikTok, and WhatsApp for sales.
The MVP will focus on supporting mobile money systems in Kenya from the start: M-Pesa, Airtel Money, and Equity Bank API.

✅ Phase 1: MVP (Local Payments with Multi-API Integration) 🎯 Core Features User Registration
Registration roles:
Individual Seller
Business
Buyer
Collected data:
Full Name
Location (City/Town)
Physical Address
Phone Number
Email Address
Role (Buyer/Seller/Business)
Optional: KYC upload (ID, passport, business certificate)
Escrow Wallet System
Escrow wallet controlled by system logic.
Multi-provider support:
M-Pesa (Daraja API)
Airtel Money API
Equity Bank API
Payment held until:
Buyer confirms delivery
Or after 7 days without a complaint
Admin can pause or release funds manually in disputes.

Transaction Workflow
Buyer creates an order.
Buyer selects payment provider (M-Pesa, Airtel, Equity).
STK Push / Redirect to Mobile App initiated.
Seller ships item (manual or tracked).
Buyer confirms delivery manually.
Disputes handled by admin if needed.
Shipment & Delivery Confirmation
Seller uploads shipment proof.
Buyer confirms receipt.
Notifications sent via SMS/email.
Dispute Resolution
Admin dashboard for:
Reviewing disputes
Uploading and viewing evidence
Manual fund release or refund
User Ratings
Post-transaction rating for buyers/sellers.
Public trust and reputation system.
Notification System
SMS/email alerts for all actions:
Order created
Payment received
Delivery pending
Funds released
Platforms: Twilio / Africa’s Talking

💸 Payment Integration (All Three APIs Included)
Provider API Usage M-Pesa Daraja API (STK Push) Mobile payments, auto-confirmation Airtel Money Airtel Money Developer API Alternate mobile money option Equity Bank Equity Eazzy API Bank payments, high-value users All APIs connected via a secure middleware layer.
Middleware:
Handles authentication, token refresh
Manages transaction logs and callback validation
Unified webhook system for updating order status

Component        | Technology/Tool         | Notes
-----------------|-------------------------|------------------------------------------
Frontend         | Next.js + Tailwind CSS  | SEO-friendly, responsive, modern UI
Backend          | Node.js + Express (TypeScript) | REST APIs, fast iteration, type-safe
Database         | PostgreSQL              | Best for relational data like orders
Auth             | JWT + bcrypt            | Secure token-based auth
File Storage     | Cloudinary              | For ID uploads, receipts, proof of delivery
Notifications    | Twilio / Africa’s Talking | SMS/Email alerts
Hosting          | Render.com              | Free tier, supports full-stack apps

📁 Project Structure
orenpay-escrow/
├── client/                       # Frontend (Next.js)
│   ├── components/              # Reusable components (Navbar, Forms, Cards, etc.)
│   ├── pages/                   # Next.js pages (routes)
│   │   ├── index.tsx           # Landing page
│   │   ├── dashboard.tsx       # User dashboard
│   │   ├── orders/             # Order list, create, details
│   │   ├── auth/               # Login, register, reset
│   │   └── admin/              # Admin dashboard
│   ├── utils/                  # API helpers, validation functions
│   └── styles/                 # Tailwind config and globals
│
├── server/                      # Backend (Node.js + Express + TypeScript)
│   ├── controllers/            # Route logic (auth, payments, orders, etc.)
│   ├── routes/                 # Express routes
│   ├── models/                 # DB models (User, Order, Transaction)
│   ├── services/               # Payment logic (mpesa.js, airtel.js, equity.js)
│   ├── middleware/             # Auth, error handlers
│   └── utils/                  # General helpers (token, logging, etc.)
│
├── config/                     # Configuration (env vars, db, cloudinary)
│   ├── db.ts                   # PostgreSQL DB connection
│   ├── cloudinary.ts          # File storage setup
│   └── providers.ts           # M-Pesa, Airtel, Equity API keys
│
├── scripts/                    # Optional scripts (DB seeders, utilities)
│
├── .env.example                # Environment variable template
├── README.md                   # Project intro and setup steps
├── package.json                # Backend dependencies
├── next.config.js              # Frontend config
├── tsconfig.json               # Shared TypeScript config
└── LICENSE

🚀 Project Roadmap 

 Setup & Auth Set up database schema (users, orders, transactions, messages)
User registration & login (with JWT auth)
KYC upload (Cloudinary)
 Escrow System + Payment Middleware Payment APIs: M-Pesa, Airtel, Equity
Unified webhook listener for payment confirmations
Escrow logic: fund holding, auto-release after timeout
 Orders, Delivery, and Disputes Buyer creates orders
Seller uploads shipment proof
Buyer confirms or raises dispute
Admin dashboard for handling disputes
 Notifications & Ratings SMS/email updates (Twilio/Africa’s Talking)
Post-transaction rating system
Logging & history view for each transaction
 Testing & Pilot Run test transactions
Try all three payment providers
Fix bugs, improve mobile UI
Pilot with 2–3 seller/buyer pairs
🔐 Security Notes All passwords hashed using bcrypt.
Role-based access (admin, buyer, seller).
Payment data encrypted in transit and never stored.
Webhooks validated via token or signature.
🌍 Future Additions
Feature Phase Web3 Escrow Smart Contracts Phase 2 React Native mobile app Phase 2 Loyalty tokens Phase 2 AI Chat Support Optional Analytics Dashboard Optional 📞 Support & Community Strategy Launch WhatsApp/Telegram group for verified businesses.
In-app chatbot with FAQs for onboarding.
Email: support@orenpay.co.ke
Add a blog for trust-building tips and transaction best practices.

🏁 Conclusion OrenPay provides a trusted bridge for online commerce in Kenya. By integrating M-Pesa, Airtel Money, and Equity Bank APIs from the start, this MVP ensures it is immediately useful and inclusive. With a focus on mobile-first design, secure payments, and manual dispute resolution, OrenPay is poised to become the go-to escrow solution for Kenya’s informal e-commerce market.


🔧 TECHNICAL DEVELOPMENT ROADMAP

🟩 Phase 1: Project Setup (Backend + Frontend Scaffolding)
Goals:
    • Initialize Express backend (using TypeScript)
    • Setup PostgreSQL connection
    • Create Next.js frontend layout


🟩 Phase 2: User Authentication System
Key Features:
    • Register/Login (Buyer, Seller, Business)
    • JWT token-based authentication
    • Password hashing with bcrypt
    • Role-based access control (RBAC)
Endpoints:
    • POST /api/auth/register
    • POST /api/auth/login
    • GET /api/auth/me
    • POST /api/auth/logout
Database Tables:
sql
CopyEdit
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100),
  email VARCHAR(100) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  password_hash TEXT NOT NULL,
  role VARCHAR(20) CHECK (role IN ('buyer', 'seller', 'business')),
  location VARCHAR(100),
  address TEXT,
  kyc_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

🟩 Phase 3: Escrow Workflow & Orders
Key Features:
    • Buyer creates an order
    • Seller is notified
    • Buyer pays via mobile money (M-Pesa/Airtel/Equity)
    • Funds go to escrow (middleware updates status)
    • Buyer confirms delivery OR timeout auto-releases funds
    • Admin can intervene
Endpoints:
    • POST /api/orders/create
    • GET /api/orders/:id
    • POST /api/orders/:id/confirm-delivery
    • POST /api/orders/:id/raise-dispute
Tables:
sql
CopyEdit
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER REFERENCES users(id),
  seller_id INTEGER REFERENCES users(id),
  item_description TEXT,
  amount NUMERIC(10, 2),
  status VARCHAR(20) DEFAULT 'pending',
  payment_method VARCHAR(20),
  proof_of_delivery_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

🟩 Phase 4: Payment Integration (Middleware API)
Tasks:
    • Build /api/payments/mpesa/stk-push
    • Build /api/payments/airtel/initiate
    • Build /api/payments/equity/initiate
    • Listen to callbacks from all 3
    • Update order status based on success/failure
We'll use mock data and later test with sandbox accounts.

🟩 Phase 5: Admin Dashboard & Disputes
Admin Capabilities:
    • View unresolved disputes
    • Pause escrow release
    • Force refund or approval
Endpoints:
    • GET /api/admin/disputes
    • POST /api/admin/orders/:id/release
    • POST /api/admin/orders/:id/refund

🟩 Phase 6: Notifications (SMS/Email)
Triggers:
    • New order created
    • Payment successful
    • Seller ships
    • Buyer confirms
    • Dispute opened/resolved
Services: Twilio or Africa’s Talking

 IMPLEMENT AUTHENTICATION SYSTEM
 generate the full authentication module now (routes, controller, model for users, JWT auth, bcrypt hashing)
 TypeScript for the backend.
