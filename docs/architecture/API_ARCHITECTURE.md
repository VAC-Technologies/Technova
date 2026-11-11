# API ARCHITECTURE & ENDPOINT SPECIFICATION
## Project: Technova — SmartStore AI
**Document Version:** 1.0.0
**Status:** Approved Architectural Baseline
**Date:** 2026-11-09
**Author:** Principal Software Architecture Team
**Repository:** `V:\Technova-recovery`

---

## 1. RESTFUL DESIGN STANDARDS & CONVENTIONS

### 1.1 URI Hierarchy and Resource Modeling
* All endpoints are rooted under `/api/`.
* Resource collections use lowercase plural nouns (e.g. `/api/stores/`, `/api/stores/:slug/products/`).
* Specific tenant resources are scoped by store slug: `/api/stores/:slug/...`.
* Customer-facing public storefront endpoints are explicitly partitioned under `/api/public/stores/:slug/...` to clearly separate customer operations from merchant administration.

### 1.2 HTTP Verbs & Standard Response Codes
* `GET`: Safe, idempotent read operations (Returns `200 OK`, `404 Not Found`).
* `POST`: Creation of entities or non-idempotent actions (Returns `201 Created`, `200 OK`, `400 Bad Request`, `409 Conflict`).
* `PATCH`: Partial entity update (Returns `200 OK`, `400 Bad Request`, `404 Not Found`).
* `DELETE`: Deletion of entities (Returns `204 No Content`, `409 Conflict` if entity is protected by foreign key references).

### 1.3 Standard Error Format
All errors return a consistent JSON schema:
```json
{
  "detail": "Descriptive human-readable error explanation.",
  "code": "optional_machine_readable_code"
}
```
Field-level validation errors (HTTP 400) return an object mapping field names to error arrays:
```json
{
  "password": [
    "This password is too short. It must contain at least 8 characters.",
    "This password is too common."
  ]
}
```

---

## 2. COMPREHENSIVE API CATALOG

### 2.1 Authentication & Profile Endpoints
| Method | Endpoint | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `POST` | `/api/auth/register/` | Public | 5 / min | Registers a new merchant or customer account. |
| `POST` | `/api/auth/login/` | Public | 10 / min | Authenticates user; returns `{access, refresh}` tokens. |
| `POST` | `/api/auth/refresh/` | Public | 30 / min | Rotates refresh token; blacklists previous token. |
| `POST` | `/api/auth/logout/` | Public / Token | None | Revokes and blacklists the provided refresh token. |
| `GET` | `/api/auth/me/` | Bearer JWT | None | Retrieves profile metadata for the authenticated user. |

### 2.2 Tenant & Store Administration
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stores/` | Bearer JWT | Lists stores where the user holds membership (paginated). |
| `POST` | `/api/stores/` | Bearer JWT | Provisions a new store and assigns `Owner` role to creator. |
| `GET` | `/api/stores/:id/` | Bearer JWT | Retrieves store profile details by store ID. |
| `PATCH` | `/api/stores/:id/` | Bearer JWT (Staff) | Updates store business info, contact details, or theme. |
| `POST` | `/api/stores/:id/assets/` | Bearer JWT (Staff) | Uploads `logo_image` or `banner_image` multipart files. |
| `GET` | `/api/stores/slug-availability/?slug=...` | Bearer JWT | Checks if a requested store slug is available. |
| `POST` | `/api/stores/:slug/publish/` | Bearer JWT (Staff) | Toggles the public visibility of the store. |
| `GET` | `/api/stores/:slug/theme/` | Bearer JWT | Retrieves current theme configuration and available options. |
| `PATCH` | `/api/stores/:slug/theme/` | Bearer JWT (Staff) | Updates active theme and customizable CSS variables. |
| `GET` | `/api/stores/:slug/analytics/` | Bearer JWT | Computes real-time revenue, order totals, and stock health. |

### 2.3 Catalog & Inventory Management
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stores/:slug/categories/` | Bearer JWT | Lists all categories defined in the store. |
| `POST` | `/api/stores/:slug/categories/` | Bearer JWT (Staff) | Creates a single new category. |
| `POST` | `/api/stores/:slug/categories/bulk/` | Bearer JWT (Staff) | Atomically creates multiple categories. |
| `GET` | `/api/stores/:slug/products/` | Bearer JWT | Lists all products in the store (including inactive). |
| `POST` | `/api/stores/:slug/products/` | Bearer JWT (Staff) | Adds a new product to the catalog. |
| `GET` | `/api/stores/:slug/products/:id/` | Bearer JWT | Retrieves single product details. |
| `PATCH` | `/api/stores/:slug/products/:id/` | Bearer JWT (Staff) | Modifies price, stock, SKU, or product details. |
| `DELETE`| `/api/stores/:slug/products/:id/` | Bearer JWT (Staff) | Deletes product (Returns 409 if referenced in orders). |
| `GET` | `/api/stores/:slug/products/import/template/` | Bearer JWT (Staff) | Downloads blank XLSX catalog import template. |
| `POST` | `/api/stores/:slug/products/import/` | Bearer JWT (Staff) | Streams, validates, and imports XLSX product rows. |

### 2.4 Storefront & Customer Operations
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/public/stores/:slug/` | Authenticated | Retrieves public store profile, categories, and active products. |
| `GET` | `/api/public/stores/:slug/products/:id/` | Authenticated | Retrieves customer-safe details for a single product. |
| `GET` | `/api/public/stores/:slug/checkout/config/` | Authenticated | Retrieves currency, COD eligibility, and delivery fee. |
| `POST` | `/api/public/stores/:slug/checkout/` | Authenticated | Creates order, verifies prices, reserves stock. |
| `GET` | `/api/orders/my/` | Authenticated | Lists personal orders placed by the current customer. |
| `GET` | `/api/orders/my/:order_number/` | Authenticated | Retrieves detailed tracking for a customer order. |
| `POST` | `/api/orders/my/:order_number/cancel/` | Authenticated | Cancels an unpaid order and restores reserved stock. |

### 2.5 Payments & Webhooks
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/orders/:order_number/payment/create/` | Authenticated | Generates a Razorpay payment order on the gateway. |
| `POST` | `/api/orders/:order_number/payment/verify/` | Authenticated | Verifies customer-submitted payment signature. |
| `POST` | `/api/orders/:order_number/payment/fail/` | Authenticated | Records customer payment failure attempt. |
| `POST` | `/api/payments/razorpay/webhook/` | HMAC Header | Asynchronous webhook receiver from Razorpay. |
| `POST` | `/api/stores/:slug/orders/:number/payment/collect/` | Staff | Marks delivered COD order payment as collected. |

### 2.6 Merchant Order Fulfillment
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/stores/:slug/orders/` | Bearer JWT (Staff) | Lists all customer orders placed with this store. |
| `PATCH` | `/api/stores/:slug/orders/:number/status/` | Bearer JWT (Staff) | Advances order fulfillment state (`Confirmed`, `Processing`, etc.). |

### 2.7 AI Business Assistant
| Method | Endpoint | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `POST` | `/api/ai/chat/` | Bearer JWT (Staff) | 10 / min | Natural language inventory inquiry powered by Gemini. |

---

## 3. IDEMPOTENCY SPECIFICATION

Every mutating request to `/api/public/stores/:slug/checkout/` mandates the `Idempotency-Key` HTTP header:
```http
POST /api/public/stores/alpha-store/checkout/ HTTP/1.1
Host: api.technova.com
Authorization: Bearer <access_token>
Idempotency-Key: 7b819e62-c0cf-4e56-821b-69796e6a1470
Content-Type: application/json

{
  "customer_name": "Aditi Sharma",
  "customer_phone": "+919876543210",
  "delivery_address": {"line1": "Flat 4B, Palm Grove", "city": "Bengaluru", "postal_code": "560001"},
  "payment_method": "razorpay",
  "items": [{"product_id": 105, "quantity": 2}]
}
```

### Idempotency State Handling
1. **Identical Submission:** Returns the original order representation (`HTTP 200 OK`).
2. **Key Conflict:** If the idempotency key matches an existing record but the request fingerprint (hash of payload + user ID) differs, returns `HTTP 409 Conflict`.
3. **First-Time Submission:** Creates the order atomically and returns `HTTP 201 Created`.

---

## 4. API VERSIONING & EVOLUTION STRATEGY

* **Current Architecture:** Rooted under `/api/`.
* **Evolution Path:** For major breaking contract changes, `/api/v1/` routing namespaces will be introduced in `backend/config/api_urls.py`. Non-breaking backward-compatible changes (adding response fields, supporting optional request parameters) will be deployed in-place.
