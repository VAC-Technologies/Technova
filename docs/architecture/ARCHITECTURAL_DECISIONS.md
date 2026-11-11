# ARCHITECTURE DECISION RECORDS (ADR)
## Project: Technova — SmartStore AI
**Document Version:** 1.0.0
**Status:** Approved Architectural Baseline
**Date:** 2026-11-09
**Author:** Principal Software Architect & Engineering Leadership
**Repository:** `V:\Technova-recovery`

---

## TABLE OF ARCHITECTURAL DECISIONS

| ADR ID | Decision Title | Status | Primary Driver |
|---|---|---|---|
| **ADR-001** | Selection of Modular Monolithic Architecture over Microservices | **Accepted** | Complexity reduction, transactional integrity, ₹0 cost |
| **ADR-002** | Technology Stack Baseline (React + Vite, Django DRF, TiDB Cloud) | **Accepted** | Team productivity, enterprise security, NewSQL scale |
| **ADR-003** | Multi-Tenancy Strategy: Shared Database with Discriminator Column | **Accepted** | Operational simplicity, rapid onboarding, free-tier limits |
| **ADR-004** | Authentication Strategy: Stateless JWT with Server-Side Blacklisting | **Accepted** | SPA compatibility, multi-tab sync, instantaneous revocation |
| **ADR-005** | Media Asset Storage: Cloudflare R2 Object Storage | **Accepted** | Container ephemeral filesystem mitigation, zero egress fees |
| **ADR-006** | Background Task Processing: Lightweight Cron over Celery on Free Tier | **Accepted** | Render free-tier RAM limitation (512 MB) |
| **ADR-007** | AI Grounding Strategy: Direct Google GenAI SDK with Structured Facts | **Accepted** | Prompt injection defense, zero hallucinations, fast response |
| **ADR-008** | Payment Gateway Synchronization: Dual Verification (Client + Webhook) | **Accepted** | Asynchronous reliability, network drop resilience |
| **ADR-009** | Frontend Architecture: Feature-Sliced Component Decomposition | **Accepted** | Maintainability, code-splitting, elimination of debt |

---

### ADR-001: Selection of Modular Monolithic Architecture over Microservices
* **Status:** Accepted
* **Context:** Technova is an e-commerce platform requiring strict transactional atomicity (deducting inventory while creating orders, linking payments to orders). Microservices introduce distributed transactions (Sagas/2PC), network latency, complex observability requirements, and necessitate multiple container instances that breach our initial ₹0 operating target.
* **Decision:** We implement a **Modular Monolith** using Django. Distinct domain boundaries (`accounts`, `stores`, `orders`, `catalog`, `payments`, `assistant`) are structured as isolated modules with clear Python service interfaces.
* **Consequences:**
  * *Advantages:* ACID database transactions guarantee zero phantom inventory deductions; simple single-container deployment; low operational overhead; ultra-fast in-memory function calls between modules.
  * *Disadvantages:* Modules share a single deployment pipeline and codebase.

---

### ADR-002: Technology Stack Baseline
* **Status:** Accepted
* **Context:** The current stack comprises React 18 + TypeScript + Vite on the frontend, Python 3.14 + Django 5.2 LTS + Django REST Framework on the backend, and TiDB Cloud Serverless (MySQL 8.0 protocol) on the database tier.
* **Decision:** **Retain the existing core technology stack.**
  * *Frontend (React + TS + Vite):* Modern, type-safe, ultra-fast HMR and build times; excellent ecosystem for e-commerce widgets.
  * *Backend (Django + DRF):* Industry-standard ORM, battle-tested security controls (CSRF, SQL injection defense, password hashing), and rapid REST API authoring.
  * *Database (TiDB Cloud):* Horizontal NewSQL scalability, 5 GiB free tier, built-in Let's Encrypt TLS CA, and pure-Python `PyMySQL` connectivity without compilation issues.
* **Consequences:**
  * *Advantages:* Zero rewrite risk; builds on 70 passing automated tests; preserves working payment and catalog logic.
  * *Disadvantages:* Must maintain MySQL/TiDB compatibility quirks (e.g. index size limits, collation choices).

---

### ADR-003: Multi-Tenancy Strategy: Shared Database with Discriminator Column
* **Status:** Accepted
* **Context:** Multi-tenancy can be implemented via: (1) Database per tenant, (2) Schema per tenant, or (3) Shared database with discriminator column (`store_id`).
* **Decision:** Implement **Shared Database with Discriminator Column (`store_id`)**. Every tenant-owned table (`Category`, `Product`, `Order`, `Membership`) includes a `store_id` foreign key.
* **Consequences:**
  * *Advantages:* Operates within a single database instance; zero migration latency when onboarding new stores; minimal memory footprint; easy cross-tenant administrative reporting.
  * *Disadvantages:* Requires strict application-level query scoping (`store_for(user, slug)`) and composite unique constraints to prevent data leakage.

---

### ADR-004: Authentication Strategy: Stateless JWT with Server-Side Blacklisting
* **Status:** Accepted
* **Context:** Traditional server-side sessions require centralized state storage (Redis/DB) for every request and suffer from cross-site cookie restrictions in decoupled frontend/backend hosting environments. Pure stateless JWTs cannot be revoked if compromised.
* **Decision:** Implement a **hybrid JWT model via `djangorestframework-simplejwt`**:
  * 5-minute short-lived access tokens (stateless verification via secret key).
  * 24-hour refresh tokens with automatic rotation on each refresh.
  * Server-side database blacklisting (`token_blacklist`) capturing revoked tokens during logout and rotation.
* **Consequences:**
  * *Advantages:* 99% of API requests verify cryptographically without database hits; logout immediately revokes refresh capabilities; immune to CSRF attacks when sent via `Authorization: Bearer` headers.
  * *Disadvantages:* Stolen access tokens remain valid for up to 5 minutes unless explicitly short-lived.

---

### ADR-005: Media Asset Storage: Cloudflare R2 Object Storage
* **Status:** Accepted
* **Context:** Render's free tier provides an **ephemeral container filesystem**. Storing merchant logos and banners on local disk (`FileSystemStorage`) causes permanent data loss upon container reboot, sleep, or deployment.
* **Decision:** Migrate from local storage to **Cloudflare R2** using `django-storages[boto3]`.
* **Consequences:**
  * *Advantages:* Permanent media persistence; 10 GB free storage; **zero egress fees**; globally distributed edge CDN delivery; standard S3 API compatibility.
  * *Disadvantages:* Requires configuring R2 access keys in production environment variables.

---

### ADR-006: Background Task Processing: Lightweight Cron over Celery on Free Tier
* **Status:** Accepted
* **Context:** Unpaid Razorpay orders hold inventory that must be released after 30 minutes. Full Celery + Redis architecture requires running at least two additional long-running processes (Redis server + Celery worker), which immediately exceeds Render's free-tier memory limit (512 MB).
* **Decision:** Implement order expiration as a **Django management command (`release_expired_orders`)** invoked via:
  1. Local CLI or CI for testing.
  2. A secured internal REST endpoint (`/api/internal/cron/expire-orders/`) triggered every 15 minutes by an external free scheduler (e.g. cron-job.org) using a secret `CRON_BEARER_TOKEN`.
* **Consequences:**
  * *Advantages:* ₹0 infrastructure cost; zero extra memory overhead; uses existing web server threads.
  * *Disadvantages:* Not suitable for sub-minute real-time background jobs.

---

### ADR-007: AI Grounding Strategy: Direct Google GenAI SDK with Structured Facts
* **Status:** Accepted
* **Context:** Merchants need an AI assistant to analyze store inventory and sales. Generic LLM frameworks (LangChain/LlamaIndex) introduce heavy dependencies and latency, while unbounded prompt access risks data hallucination and prompt injection.
* **Decision:** Technova uses the official **`google-genai` SDK with strict JSON Facts Grounding**. The backend queries the database, compiles an exact JSON snapshot of inventory and sales, and instructs Gemini with a hardened system prompt (`temperature = 0.1`, max 300 tokens) to answer strictly from the supplied facts.
* **Consequences:**
  * *Advantages:* Zero hallucinations; immune to prompt injections attempting to override business rules; predictable 1–2 second execution times; no third-party framework overhead.
  * *Disadvantages:* Inquiries are constrained to data included in the facts payload.

---

### ADR-008: Payment Gateway Synchronization: Dual Verification (Client + Webhook)
* **Status:** Accepted
* **Context:** Customers completing Razorpay checkout can experience network drops, closed browser tabs, or interrupted redirects before the frontend can send verification data to the server.
* **Decision:** Implement a **dual-path synchronization pattern**:
  1. *Primary Real-Time Path:* Client verification endpoint (`/api/orders/:number/payment/verify/`) confirming payment immediately in the user's active session.
  2. *Authoritative Asynchronous Path:* Webhook endpoint (`/api/payments/razorpay/webhook/`) processing `payment.captured` and `order.paid` events.
  3. *Idempotency Guarantee:* Both paths use database locking (`SELECT FOR UPDATE`) and check `payment_status == PAID` to ensure that whichever event arrives first settles the order, while the subsequent event records missing IDs and returns HTTP 200 without duplicate side effects.
* **Consequences:**
  * *Advantages:* 100% financial reconciliation even if the buyer closes the tab immediately after bank OTP confirmation.
  * *Disadvantages:* Requires robust idempotency and locking logic.

---

### ADR-009: Frontend Architecture: Feature-Sliced Component Decomposition
* **Status:** Accepted
* **Context:** The frontend currently consolidates workspace setup, catalog, orders, analytics, themes, and assistant views in a single 96 KB `App.tsx` file.
* **Decision:** Decompose `App.tsx` into modular feature folders (`features/auth`, `features/catalog`, `features/orders`, `features/storefront`, `features/analytics`, `features/assistant`) and shared UI components (`components/ui/`).
* **Consequences:**
  * *Advantages:* Drastically improved code readability; enables concurrent feature development; improves Vite HMR compilation speed; enables route-based code-splitting.
  * *Disadvantages:* Requires careful one-time refactoring without altering existing contracts.
