# 🟩 ORENPAY Escrow & Logistics Platform — Technical Specification & Roadmap 🧭

## 1. Project Overview

OrenPay is an escrow and logistics coordination platform designed for Kenya's informal online economy. It secures buyer-seller transactions for individuals and businesses using social media (Facebook, Instagram, TikTok, WhatsApp) and integrates local transport providers (Saccos, riders) for delivery.

**Core Goals:**
*   Provide trust through escrow-secured payments. **(Tagline Idea: “Secure, trusted payments & delivery — powered by your local Saccos and riders.”)**
*   Enable seamless transactions using M-Pesa, Airtel Money, and Equity Bank.
*   Facilitate reliable delivery by coordinating local Saccos and riders. **(Highlight: OrenPay works hand-in-hand with your local Sacco riders to deliver goods securely. No national courier? No problem.)**
*   Offer KYC/KYB for user verification.
*   Automate shipment tracking and payment release where possible.
*   **Explain the Escrow + Rider integration clearly to first-time users.**

## 2. Technology Stack

| Component     | Technology/Tool         | Notes                                      |
| ------------- | ----------------------- | ------------------------------------------ |
| Frontend      | Next.js + Tailwind CSS  | SEO-friendly, responsive UI, PWA potential |
| Backend       | Node.js + Express (TS)  | REST APIs, type-safe, scalable             |
| Database      | PostgreSQL              | Relational data (users, orders, shipments) |
| Auth          | JWT + bcrypt            | Secure token-based authentication          |
| File Storage  | Cloudinary              | KYC docs, proof of delivery images         |
| Notifications | Twilio / Africa’s Talking | SMS/Email/WhatsApp alerts                  |
| Realtime      | Socket.IO               | Live dashboard updates, agent tracking     |
| Queues/Workers| BullMQ + Redis          | Background jobs (assignments, fallbacks)   |
| Geo-queries   | PostGIS (PostgreSQL) / Redis Geo | Efficient location-based lookups       |
| Maps/Routing  | Google Maps API         | Distance Matrix, Geocoding, ETA            |
| Hosting       | Render.com              | Supports full-stack apps, DB hosting       |

## 3. Project Structure

*(Reflects current workspace)*

```
orenpay-escrow-platform/
├── client/                       # Frontend (Next.js App Router)
│   ├── public/                  # Static assets (logos, etc.)
│   ├── src/
│   │   ├── app/                 # Main application routes/pages
│   │   │   ├── (layout, page, globals.css)
│   │   │   ├── admin/
│   │   │   ├── auth/ (login, register)
│   │   │   ├── dashboard/
│   │   │   └── orders/ (list, create, details)
│   │   ├── components/          # Reusable UI (Navbar, Footer, Forms)
│   │   └── contexts/            # Global state (AuthContext)
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── server/                       # Backend (Node.js + Express + TypeScript)
│   ├── controllers/             # Request/Response logic
│   ├── middleware/              # Auth, validation, error handling
│   ├── models/                  # Data structures/interfaces (User, Order, etc.)
│   ├── routes/                  # API endpoint definitions
│   ├── services/                # Business logic (payments, notifications, logistics)
│   ├── utils/                   # Helpers (token generation, logging)
│   └── workers/                 # Background job handlers (e.g., BullMQ) - *To be added*
│
├── config/                      # Shared configuration
│   ├── cloudinary.ts
│   ├── db.ts                    # PostgreSQL connection pool
│   └── providers.ts            # API keys/configs (loaded via .env)
│
├── scripts/                     # Utility scripts (DB migrations/seeders) - *Optional*
├── src/                         # Root for backend entry point
│   └── server.ts                # Main Express app setup
│
├── .env                         # Local environment variables (DO NOT COMMIT)
├── .env.example                 # Template for environment variables
├── package.json                 # Backend dependencies & scripts
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

## 4. Development Roadmap & Features

### Phase 1: Core Escrow MVP 

*   **User Authentication (Implemented):**
    *   Registration (Buyer, Seller, Business) with email, phone, name, location, address, role.
    *   Login with email/password.
    *   JWT generation and validation (`server/middleware/authMiddleware.ts`).
    *   Password hashing with bcrypt.
    *   Role-Based Access Control (RBAC) foundations.
    *   Endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`.
    *   Model: `server/models/User.ts`.
*   **Basic Order Creation (Implemented):**
    *   Buyer creates an order specifying item, amount, seller.
    *   Endpoints: `/api/orders/create`, `/api/orders`, `/api/orders/:id`.
    *   Model: `server/models/Order.ts`.
    *   Frontend form (`client/src/app/orders/create/page.tsx`) implemented.
*   **Payment Integration (M-Pesa, Airtel, Equity, JamboPay, iPay, Pesapal, T-Kash, DPO) (Implemented):**
    *   Integrate Daraja API (STK Push), Airtel Money API, Equity Eazzy API, JamboPay API, iPay API, Pesapal API, T-Kash API, DPO API.
    *   Secure middleware for API calls, token handling (`server/services/mpesa.ts`, `server/services/airtel.ts`, `server/services/equity.ts`, `server/services/jambopay.ts`, `server/services/ipay.ts`, `server/services/pesapal.ts`, `server/services/tkash.ts`, `server/services/dpo.ts`, etc.).
    *   Webhook listeners for payment confirmation (`server/routes/payment.ts`, `server/middleware/webhookMiddleware.ts`).
    *   Update order status upon successful payment.
    *   Model: `server/models/Transaction.ts`.
*   **Manual Escrow Logic (Implemented):**
    *   Hold funds upon successful payment confirmation.
    *   Buyer manually confirms delivery via frontend.
    *   Seller uploads proof of shipment (Cloudinary integration - `config/cloudinary.ts`).
    *   Timeout logic: Auto-release funds after 7 days if no dispute and no confirmation.
    *   Endpoints: `/api/orders/:id/confirm-delivery`, `/api/orders/:id/upload-proof`.
*   **Basic Dispute Resolution (Partially Implemented):**
    *   Buyer/Seller can raise a dispute on an order.
    *   Admin dashboard (`client/src/app/admin/page.tsx`) to view disputes.
    *   Admin manual actions: Force release funds, force refund.
    *   Endpoints: `/api/orders/:id/raise-dispute`, `/api/admin/orders/:id/release`, `/api/admin/orders/:id/refund`.
*   **Notifications (SMS/Email) (Partially Implemented):**
    *   Integrate Twilio/Africa's Talking (`server/services/notificationService.ts`).
    *   Send alerts for: Order created, Payment received, Shipment proof uploaded, Delivery confirmed, Dispute status changes.
*   **User Verification (NEW):**
    *   Email and phone verification required during registration.
    *   Endpoints: `/api/auth/verify-email?token=...` (GET), `/api/auth/verify-phone` (POST, `{ phone_number, otp }`).
*   **User Ratings:**
    *   Simple post-transaction rating system for buyers/sellers.
*   **Optional Enhancements (Mini Phase 1.1):**
    *   Email verification + phone OTP.
    *   Basic referral tracking (invite codes).
    *   Enhanced user profiles (profile picture, basic KYC tags).

### Phase 2: Logistics Integration - Saccos & Riders

*   **Transporter Onboarding:**
    *   Admin interface to register Saccos/Riders.
    *   Collect: Name, Contact (Phone), Routes covered (Origin/Destination points), Vehicle type (optional).
    *   Implement KYC/KYB process for transporters.
    *   Model: `agents` table (add columns for `name`, `phone`, `routes_covered`, `is_sacco`, `is_rider`, `status`, `current_load`, `score`, `location`, `last_ping`, `kyc_status`).
    *   Frontend: Display "Verified" badges for agents who complete KYC/KYB.
*   **Shipment Dashboard (PWA or Web):**
    *   Dedicated interface for registered Saccos/Riders.
    *   View assigned shipments/legs.
    *   Update status: `Accepted`, `Picked Up`, `In Transit`, `Delivered to Hub`, `Delivered to Buyer`.
    *   Upload proof of handover/delivery (photo).
    *   Accessible via mobile browser (PWA for offline potential).
*   **Multi-Leg Shipment Logic:**
    *   Backend logic to break down routes (e.g., Kitui -> Nairobi -> Kisumu).
    *   Model: `shipments` table (link to `orders`, track `current_leg`, `status`, `assigned_agent_id`, `pickup_location`, `delivery_location`, `estimated_time`, `actual_time`).
    *   Model: `shipment_legs` table (track each segment: `shipment_id`, `leg_number`, `agent_id`, `status`, `pickup_time`, `delivery_time`, `proof_url`).
*   **Manual Assignment (Initial):**
    *   Admin dashboard feature to assign shipments/legs to specific Saccos/Riders based on route.
    *   Endpoints: `/api/admin/shipments/:id/assign`.
*   **Handover Confirmation (Manual/Simple):**
    *   Agent updates status via dashboard.
    *   Buyer confirms final delivery via main app.
    *   Escrow release triggered by buyer confirmation + final leg marked 'Delivered'.

### Phase 3: Logistics Automation & Optimization

*   **Automated Smart Assignment:**
    *   Implement `assignmentService.ts` using BullMQ workers.
    *   Logic: When shipment created/leg completed, find best next agent based on:
        *   Route match (using PostGIS/Redis Geo).
        *   Agent `status` (online/available).
        *   `current_load`.
        *   `score` (performance rating).
        *   ETA (optional, via Google Maps Distance Matrix).
    *   Use Redis for caching agent locations/status (`agent:<id>:location`, `agent:<id>:status`).
*   **Real-time Tracking:**
    *   Integrate Socket.IO (`server/socket.ts` - *to be added*).
    *   Agents ping location/status via PWA/Dashboard (`agent:ping`).
    *   Admin dashboard shows live agent locations (Leaflet/Mapbox integration).
    *   Buyer sees real-time status updates.
*   **Automated Handover (QR/OTP):**
    *   Generate unique QR code or OTP for each shipment leg.
    *   Receiving agent scans/enters code via dashboard to confirm handover.
    *   Update `shipment_legs.status` automatically.
    *   Endpoint: `/api/shipments/legs/:legId/confirm-handover`.
*   **Automated Escrow Release:**
    *   Trigger escrow release when:
        *   Final `shipment_legs.status` is 'Delivered'.
        *   Buyer confirms receipt OR timeout period expires after delivery.
        *   (Optional) Proof of delivery uploaded and verified.
*   **Fallback Logic:**
    *   BullMQ worker (`fallbackWorker.ts`) monitors assigned legs.
    *   If agent doesn't accept/pickup within X minutes, re-assign automatically.
    *   Notify admin if no fallback agent found.
*   **Agent Performance Scoring & Incentives:**
    *   Background job/worker updates agent `score` based on:
        *   On-time delivery (+).
        *   Successful handovers (+).
        *   Positive buyer feedback (+).
        *   Missed pickups/late deliveries (-).
        *   Failed handovers (-).
    *   Develop agent incentive programs (tiers, bonuses based on score/reliability).
*   **AI-Powered Logistics Enhancements:**
    *   Implement more accurate ETA predictions using historical data and real-time traffic.
    *   Develop dynamic pricing suggestions for delivery based on demand, distance, agent availability.
    *   Explore optimized route planning and potential consolidation opportunities.

### Phase 4: Security, Compliance & Trust

*   **Authentication & Authorization:**
    *   Implement JWT refresh token strategy with short access token expiry.
    *   Refine and enforce Role-Based Access Control (RBAC) middleware across all sensitive endpoints.
*   **Input Validation:**
    *   Mandate strict input validation using Zod or Joi on all API request bodies, query params, and path params.
*   **Payment & Webhook Security:**
    *   Store API keys securely using environment variables and secrets management.
    *   Implement and enforce webhook signature verification for all incoming payment provider webhooks.
*   **Secure File Handling:**
    *   Validate file types, sizes, and potentially scan for malware upon upload (Cloudinary add-ons or custom).
    *   Implement secure access controls for sensitive documents (e.g., KYC).
*   **Rate Limiting & Abuse Prevention:**
    *   Implement rate limiting on public endpoints (login, registration, password reset, OTP requests).
    *   Develop basic AI/rule-based fraud detection mechanisms to flag suspicious transactions or account activities.
*   **Audit Trails:**
    *   Implement comprehensive logging for critical actions (payments, escrow release, admin actions, profile changes).

### Phase 5: User Experience, Community & Ecosystem

*   **Frontend Polish, UI/UX Enhancements & Accessibility:**
    *   **Visual Design & Branding:**
        *   Utilize Tailwind CSS effectively for a modern, clean, and visually appealing interface. Consider component libraries like Shadcn/ui or Headless UI for consistency.
        *   Incorporate subtle Kenyan design elements or color palettes to resonate locally (e.g., icons showing a boda, street vendor, Sacco kiosk).
        *   Ensure consistent branding (logo, colors) across all platforms (web, emails, notifications).
        *   Use high-quality illustrations/icons to explain complex processes (escrow, logistics). **(Add: Visual journey: Buyer → OrenPay → Seller → Rider → Buyer)**
        *   **Header/Hero Section:** Compelling tagline (e.g., "Secure, trusted payments & delivery..."), Primary CTA ("Get Started", "How It Works").
    *   **User Experience (General):**
        *   Prioritize a **Mobile-First Design** approach for responsiveness.
        *   **Simplify Onboarding:** Streamline registration, consider social logins, break down complex forms (KYC/KYB) into steps. Use minimal forms.
        *   Implement **Intuitive Navigation** (e.g., bottom nav for mobile, clear sidebars/topbars for desktop).
        *   **Performance:** Optimize loading times (image optimization, code splitting, efficient data fetching).
        *   **Use maps sparingly on mobile—focus on concise progress steps instead.**
        *   **Enable interaction via WhatsApp deep linking where useful.**
    *   **Core Escrow & Transaction Flow:**
        *   **Visualize Escrow Status:** Use progress bars or clear status indicators for escrow stages.
        *   **Actionable Dashboards:** Design user-specific dashboards (Buyer, Seller) highlighting pending actions, orders, and notifications.
        *   **Trust Signals:** Prominently display security badges (M-Pesa, Airtel, Equity, Twilio), user ratings, verification status, and escrow protection details. **(Add: Placeholder testimonials for credibility).**
        *   **"Why OrenPay?" Section:** Clearly state benefits (Escrow protection, Trusted local transport, M-Pesa/Airtel/Equity integration, Built for informal online commerce).
        *   **CTA Section:** Strong CTA (e.g., "Start selling safely today") with trust-building text ("No app needed. We’ll text you updates.").
    *   **Logistics & Agent Experience (PWA Focus):**
        *   Design the agent interface specifically for mobile use (PWA).
        *   Integrate interactive maps (Leaflet/Mapbox) for routes and locations (use sparingly on mobile).
        *   Simplify status updates for agents (large buttons, clear options).
        *   Implement seamless QR/OTP handover confirmation.
        *   **Use Socket.IO for real-time updates to buyers (like “rider is nearby”).**
        *   **OTP flows via Twilio/Africa's Talking: Add spinner/loading state.**
    *   **Admin Interface:**
        *   Use data visualization (charts, graphs) for key metrics.
        *   Design for efficient management workflows (users, orders, disputes).
    *   **Accessibility (a11y):** Ensure full compliance with WCAG guidelines (semantic HTML, ARIA, keyboard navigation, color contrast).
    *   Consider adding a Dark Mode option.
*   **Community & Communication:**
    *   Implement simple in-app chat functionality for order coordination (Buyer <-> Seller, Buyer/Seller <-> Assigned Agent). Use Socket.IO for real-time capabilities.
    *   Enhance referral/invite tracking features.
*   **Seller Tools:**
    *   Provide basic value-added tools for frequent sellers (e.g., simple inventory overview, bulk order creation template).
*   **Frontend Optimizations:**
    *   Leverage Next.js features (ISR, SSR, Caching) for performance.
    *   Optimize images using `next/image` and CDNs.
*   **Footer:** Include Quick links (Terms, FAQ, Sign Up, Support) and a Sacco/Rider onboarding CTA ("Are you a Sacco or rider? Partner with us.").

*   **Suggested Flow-Based Pages/Views:**
    *   `/start-transaction`: Buyer inputs seller phone number, amount, optional delivery info.
    *   `/track-order`: Buyer views progress steps, optional map, chat with rider.
    *   `/agent-app` (PWA/Web): View assigned pickups/deliveries, update status, confirm handovers (QR/OTP).
    *   `/agent-onboard`: Form for Saccos/Riders to sign up, provide details, start KYC.

### Phase 6: Scaling, DevOps & Observability

*   **Infrastructure & Deployment:**
    *   Configure hosting environment (e.g., Render) for auto-scaling.
    *   Implement a robust CI/CD pipeline (e.g., GitHub Actions) for automated testing and deployment.
    *   Set up distinct staging and production environments.
*   **Monitoring & Logging:**
    *   Integrate comprehensive logging (e.g., Winston) across backend services and workers.
    *   Set up real-time error monitoring and alerting (e.g., Sentry, Datadog).
    *   Implement distributed tracing (e.g., OpenTelemetry) to track requests across services (API, workers).
    *   Utilize BullMQ monitoring dashboards (e.g., Arena UI) for queue health.
*   **Data Management:**
    *   Implement regular automated database backups (PostgreSQL) and test restore procedures.
    *   Configure Redis persistence and failover mechanisms if used heavily beyond caching.
*   **Analytics & Business Intelligence:**
    *   Implement a dedicated analytics layer or integrate BI tools (e.g., Metabase, Superset) for operational insights, user behavior analysis, and performance tracking.
    *   **Developer Experience:**
    *   Maintain comprehensive API documentation (e.g., using Swagger/OpenAPI generated from code).
    *   Invest in automated testing suites (unit, integration, end-to-end).

## 4.1 Implemented Features Summary (Tracked from Roadmap)

*This section summarizes features marked as (Implemented) or (Partially Implemented) in the roadmap above.*

*   **User Authentication:**
    *   Registration (Buyer, Seller, Business)
    *   Login
    *   JWT generation and validation
    *   Password hashing
    *   Basic RBAC foundations
    *   Endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`
    *   Model: `server/models/User.ts`
*   **Basic Order Creation:** Backend endpoints and frontend form implemented.
*   **(Implemented) Payment Integration:** Initial setup exists for M-Pesa, Airtel, Equity, JamboPay, iPay, Pesapal, T-Kash, DPO. Webhook listeners are in place.
*   **(Implemented) Manual Escrow Logic:** Basic structure for holding funds, confirmation, proof upload.
*   **(Partially Implemented) Basic Dispute Resolution:** Admin dashboard view and manual actions.
*   **(Partially Implemented) Notifications (SMS/Email):** Service integration exists.
*   **Cloudinary Integration:** Setup in `config/cloudinary.ts`.

*(Please update this list as more features from the roadmap are completed.)*

## 5. Future Enhancements (Post-Core Roadmap)

*   **Web3 Escrow:** Optional Solidity smart contracts for payment holding/release.
*   **React Native App:** Dedicated mobile apps for buyers, sellers, and agents.
*   **AI Chat Support:** Integrate Dialogflow/OpenAI for customer service.
*   **Advanced Analytics:** Dashboards (Metabase/PostHog) for business insights.
*   **Offline Capability:** Enhance agent PWA with Service Workers/PouchDB for offline data sync.
*   **Loyalty/Reward System:** Tokens or points for frequent users/high-performing agents.

## 6. Support & Community

*   Establish support channels (Email: support@orenpay.co.ke, WhatsApp/Telegram group).
*   Develop FAQ/Help section within the app/website.
*   Blog for updates, tips, and trust-building content.

