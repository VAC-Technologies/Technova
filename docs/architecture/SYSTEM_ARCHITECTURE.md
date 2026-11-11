# SYSTEM ARCHITECTURE DESIGN
## Project: Technova — SmartStore AI
**Document Version:** 1.0.0
**Status:** Architectural Baseline
**Date:** 2026-11-09
**Author:** Principal Software Architecture & Engineering Team
**Repository:** `V:\Technova-recovery`

---

## 1. ARCHITECTURAL PHILOSOPHY & PRINCIPLES

Technova is architected around the **Modular Monolithic** design pattern. For an early-stage to high-growth multi-tenant SaaS platform, a well-structured modular monolith provides the optimal balance of development velocity, transactional data integrity, low operational complexity, and ₹0-friendly deployment economics, while cleanly establishing architectural boundaries that can be split into microservices if specific domains demand independent scale in the future.

### Key Engineering Principles
1. **SOLID Principles:** Single responsibility per Django app/module; open for extension via pluggable theme configurations and payment adapters; interface segregation through targeted REST serializers; dependency inversion by decoupling payment gateway specifics behind provider abstractions.
2. **DRY & KISS:** Common business logic (such as tenant slug resolution, currency formatting, and inventory reservation) is consolidated into domain services rather than duplicated across views. Code remains explicit and straightforward.
3. **High Cohesion & Low Coupling:** Domain boundaries (`accounts`, `stores`, `orders`, `catalog`, `payments`, `assistant`) encapsulate their own data access and validation rules, interacting through clear Python service interfaces.
4. **Security by Design & Fail-Safe Defaults:** Every endpoint requires authentication by default (`IsAuthenticated`), with public access granted only to explicitly allowlisted routes (`AllowAny`). Tenant authorization checks run on every database lookup.
5. **Stateless Backend Execution:** The Django application holds zero in-memory session state across requests. Session identity is established via cryptographic JWTs, allowing seamless horizontal scaling behind load balancers.

---

## 2. SYSTEM CONTEXT DIAGRAM (C4 LEVEL 1)

The following diagram illustrates how Technova interacts with human actors and external cloud services:

```mermaid
flowchart TD
    subgraph Users ["Actors"]
        Buyer["Buyer / Customer<br/>(Authenticated)"]
        Merchant["Store Owner & Staff<br/>(Authenticated Merchant)"]
        Admin["Platform Admin<br/>(Superuser)"]
    end

    subgraph Platform ["Technova Platform"]
        SPA["Frontend SPA<br/>(React + TypeScript on Vercel)"]
        API["Backend API<br/>(Django REST Framework on Render)"]
    end

    subgraph External ["External Services"]
        TiDB["TiDB Cloud<br/>(Managed Distributed MySQL Database)"]
        Razorpay["Razorpay Payment Gateway<br/>(Checkout, Order API, Webhooks)"]
        Gemini["Google Gemini AI<br/>(Generative Business Intelligence)"]
        Storage["Object Storage<br/>(Cloudflare R2 / AWS S3)"]
    end

    Buyer -->|Browses Storefront, Adds to Cart, Checks Out| SPA
    Merchant -->|Manages Products, Inventory, Orders, Themes| SPA
    Admin -->|System Telemetry, Global Operations| SPA

    SPA -->|HTTPS / REST / JWT| API

    API -->|SQL Queries & Transactions via TLS| TiDB
    API -->|Create Order, Verify HMAC, Lookup Payment| Razorpay
    Razorpay -->|Asynchronous Payment Webhooks| API
    API -->|Structured Prompt & JSON Facts via TLS| Gemini
    API -->|Signed Media Uploads & Assets| Storage
```

---

## 3. CONTAINER ARCHITECTURE DIAGRAM (C4 LEVEL 2)

The container view details the execution environments, deployment topology, and protocols connecting system subsystems:

```mermaid
flowchart TB
    subgraph ClientTier ["Client Tier (Browser)"]
        Browser["Evergreen Web Browser<br/>(React 18 SPA)"]
    end

    subgraph EdgeTier ["Edge & Ingress Tier"]
        VercelCDN["Vercel Edge Network<br/>(Global CDN / SSL Termination)"]
        RenderIngress["Render Cloud Ingress<br/>(TLS 1.3 Termination, Reverse Proxy)"]
    end

    subgraph ComputeTier ["Application Tier (Docker / Linux)"]
        subgraph BackendContainer ["Django App Container"]
            Gunicorn["Gunicorn WSGI Master<br/>(Multi-worker Python 3.14)"]
            WhiteNoise["WhiteNoise Middleware<br/>(Gzip/Brotli Compressed Static Assets)"]
            DRF["Django REST Framework<br/>(Authentication, Rate Limiting, ORM)"]
            SecurityMW["Security Middleware<br/>(HSTS, CORS, Clickjacking, CSP)"]
        end
    end

    subgraph DataTier ["Data & Persistence Tier"]
        TiDBCluster[("TiDB Cloud Serverless<br/>MySQL 8.0 Protocol, Port 4000<br/>ISRG Root X1 SSL CA")]
        MediaBucket[("Object Storage (R2 / S3)<br/>Product Images, Logos, Banners")]
    end

    subgraph ExternalGateways ["External Partner APIs"]
        RazorpayAPI["Razorpay REST API<br/>(api.razorpay.com)"]
        GeminiAPI["Google GenAI API<br/>(generativelanguage.googleapis.com)"]
    end

    Browser -->|HTTPS GET / Static Chunks| VercelCDN
    Browser -->|HTTPS REST API Requests with Bearer JWT| RenderIngress

    RenderIngress -->|Forward with X-Forwarded-Proto: https| Gunicorn
    Gunicorn --> WhiteNoise
    WhiteNoise --> SecurityMW
    SecurityMW --> DRF

    DRF -->|PyMySQL over TLS with CA Verification| TiDBCluster
    DRF -->|HTTPS REST over HTTPX| RazorpayAPI
    DRF -->|HTTPS SDK via google-genai| GeminiAPI
    DRF -->|Media Store & Fetch| MediaBucket
```

---

## 4. BACKEND MODULE ARCHITECTURE (MODULAR MONOLITH)

The Django backend is decomposed into domain-specific modules adhering to separation of concerns:

```text
backend/
├── config/                  # Core orchestration & project settings
│   ├── settings.py          # Security, Database, JWT, Logging, CORS config
│   ├── api_urls.py          # Canonical REST API routing table
│   ├── wsgi.py / asgi.py    # Production web server entrypoints
├── apps/
│   ├── accounts/            # Identity & Access Management
│   │   ├── models.py        # Custom Email-based User model
│   │   ├── auth.py          # JWT authentication, refresh blacklisting
│   │   ├── serializers.py   # User registration & profile serializers
│   │   └── throttles.py     # IP & user-scoped rate limiters
│   ├── stores/              # Multi-Tenant Business & Storefront Domain
│   │   ├── models.py        # Store, Membership, Category, Product, Order
│   │   ├── views.py         # Store CRUD, Catalog, Categories, Analytics
│   │   ├── order_views.py   # Checkout, Customer Orders, Razorpay Webhook
│   │   ├── assistant_views.py # AI Chat endpoints
│   │   ├── assistant_service.py # Gemini RAG facts extraction & grounding
│   │   ├── imports.py       # Excel (XLSX) streaming parser & validation
│   │   ├── serializers.py   # Catalog serializers with tenant scoping
│   │   └── order_serializers.py # Order & Item read/write serializers
```

---

## 5. DETAILED DATA FLOW ARCHITECTURES

### 5.1 Authentication & Token Verification Flow
```mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant API as Django API Gateway
    participant SimpleJWT as SimpleJWT Auth Middleware
    participant DB as TiDB Database

    User->>API: POST /api/auth/login/ (email, password)
    Note over API: ScopedRateThrottle (10/min)
    API->>DB: Query User by email
    DB-->>API: User record + password hash
    API->>API: Verify password (PBKDF2)
    alt Invalid credentials
        API-->>User: 401 Unauthorized (Audit log warning)
    else Valid credentials
        API->>API: Generate Access Token (5m) & Refresh Token (24h)
        API-->>User: 200 OK {access, refresh}
    end

    Note over User, API: Authenticated API Calls
    User->>API: GET /api/stores/ [Authorization: Bearer <access>]
    API->>SimpleJWT: Decode & verify HMAC-SHA256 signature
    alt Expired / Tampered Token
        API-->>User: 401 Unauthorized (Token invalid or expired)
        User->>API: POST /api/auth/refresh/ {refresh: <token>}
        API->>DB: Check if refresh token is blacklisted
        alt Token Blacklisted
            API-->>User: 401 Unauthorized (Token revoked)
        else Token Valid
            API->>DB: Blacklist old refresh token
            API->>API: Issue new Access Token + rotated Refresh Token
            API-->>User: 200 OK {access, refresh}
        end
    else Valid Token
        API->>DB: Execute tenant-scoped query
        DB-->>API: Filtered records
        API-->>User: 200 OK {results: [...]}
    end
```

### 5.2 Multi-Tenant Data Isolation Flow
```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Store Staff
    participant View as Django View / ViewSet
    participant Helper as store_for(user, slug, write=True)
    participant DB as TiDB Database

    Merchant->>View: PATCH /api/stores/alpha-store/products/42/
    View->>Helper: Resolve tenant context (user, slug, write=True)
    Helper->>DB: SELECT store FROM Store JOIN Membership WHERE slug='alpha-store' AND user_id=X AND role IN ('owner','admin','editor')
    alt No matching membership
        DB-->>Helper: None
        Helper-->>View: 404 Not Found (Prevent tenant enumeration)
        View-->>Merchant: 404 Store not found or access denied
    else Authorized Tenant Member
        DB-->>Helper: Store Instance
        View->>DB: SELECT product FROM Product WHERE store_id=Store.id AND id=42
        alt Product does not belong to store
            DB-->>View: None
            View-->>Merchant: 404 Product not found
        else Product belongs to store
            View->>DB: UPDATE Product SET price=... WHERE id=42 AND store_id=Store.id
            DB-->>View: Success
            View-->>Merchant: 200 OK {product}
        end
    end
```

### 5.3 Checkout & Asynchronous Razorpay Webhook Flow
```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer (Frontend)
    participant API as Technova Backend API
    participant DB as TiDB Database
    participant Razorpay as Razorpay API / Webhook

    Customer->>API: POST /api/public/stores/:slug/checkout/ [Idempotency-Key]
    critical Atomic Checkout Transaction
        API->>DB: Lock requested products (SELECT FOR UPDATE)
        API->>API: Validate stock availability & compute true DB totals
        API->>DB: Decrement stock, create Order (status=Placed, payment_status=Pending, stock_reserved=True)
    end
    API-->>Customer: 201 Created {order_number, total}

    Customer->>API: POST /api/orders/:number/payment/create/
    API->>Razorpay: POST /v1/orders {amount, currency, receipt=order_number}
    Razorpay-->>API: 201 Created {id: "order_rzp_123"}
    API->>DB: Update Order.razorpay_order_id = "order_rzp_123"
    API-->>Customer: 201 Created {key_id, razorpay_order_id, amount}

    Customer->>Customer: Complete payment via Razorpay Modal
    Razorpay->>API: POST /api/payments/razorpay/webhook/ [X-Razorpay-Signature]
    API->>API: Constant-time HMAC-SHA256 signature verification
    alt Invalid Signature
        API-->>Razorpay: 400 Bad Request (Reject untrusted payload)
    else Signature Verified
        critical Atomic Webhook Processing
            API->>DB: Lock Order (SELECT FOR UPDATE by razorpay_order_id)
            API->>API: Cross-check order_id, amount, currency against DB
            alt event == 'payment.captured' or 'order.paid'
                API->>DB: Set payment_status=PAID, status=CONFIRMED, record razorpay_payment_id
                API->>DB: Add OrderStatusHistory audit entry
            else event == 'payment.failed'
                API->>DB: Record attempt failure; KEEP stock_reserved=True for retry
            end
        end
        API-->>Razorpay: 200 OK {detail: "Payment recorded successfully"}
    end
```

### 5.4 Gemini AI RAG & Grounded Facts Flow
```mermaid
sequenceDiagram
    autonumber
    actor Merchant as Merchant
    participant API as Assistant View (/api/ai/chat/)
    participant Facts as assistant_service.inventory_facts()
    participant DB as TiDB Database
    participant Gemini as Google Gemini 2.5 Flash

    Merchant->>API: POST /api/ai/chat/ {store_slug: "my-shop", question: "Which products are running low?"}
    Note over API: ScopedRateThrottle (10/min)
    API->>DB: Verify user has membership in "my-shop"
    API->>Facts: Generate store facts JSON
    Facts->>DB: Query active catalog, stock levels, sales summaries
    DB-->>Facts: Raw database rows
    Facts-->>API: Sanitized facts JSON {store, products, low_stock, sales_reports}

    API->>Gemini: POST generateContent(system_instruction=STRICT_FACTS_ONLY, contents={question, facts})
    alt Provider Timeout (> 15s) or API 504
        Gemini-->>API: Timeout
        API-->>Merchant: 504 Gateway Timeout (Graceful retry prompt)
    else Successful Generation
        Gemini-->>API: Grounded Answer Text
        API-->>Merchant: 200 OK {answer: "...", evidence: facts}
    end
```

---

## 6. FRONTEND SPA ARCHITECTURE

The frontend is a single-page application built with React 18, TypeScript, and Vite.

### Core Architectural Layers
1. **API Client Layer (`src/api.ts`):** Centralized HTTP abstraction over `fetch`. Handles automatic JWT injection, synchronized token refresh across tabs, 401 retry loops, and error transformation.
2. **State & Synchronization Layer:** Multi-tab storage sync (`storage` event listeners) guaranteeing that session invalidation in one tab instantly updates all active tabs.
3. **Route & View Controller Layer (`src/App.tsx`, `src/PublicStorefront.tsx`):**
   * **Authentication Guard:** Renders `<AuthScreen/>` whenever tokens are missing or invalidated.
   * **Storefront Controller (`/store/:slug`):** Public customer shopping view with local cart persistence.
   * **Workspace Controller (`/`):** Merchant operational dashboard managing catalog, orders, analytics, themes, and AI assistant.
