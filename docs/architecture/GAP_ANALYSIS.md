# ARCHITECTURAL GAP ANALYSIS
## Project: Technova — SmartStore AI
**Document Version:** 1.0.0
**Status:** Approved Architectural Baseline
**Date:** 2026-11-09
**Author:** Principal Software Architect & QA Lead
**Repository:** `V:\Technova-recovery`

---

## 1. EVALUATION METHODOLOGY

This gap analysis compares the existing codebase in `V:\Technova-recovery` against the commercial-grade multi-tenant requirements defined in the SRS and System Architecture documents.

### Severity Classification
* **CRITICAL:** High risk of data loss, security compromise, financial discrepancy, or service outage in production. Must be resolved before commercial launch.
* **HIGH:** Significant functionality gap, operational friction, or performance degradation under load.
* **MEDIUM:** Maintainability issue, architectural debt, or suboptimal user experience that does not halt core commercial operations.
* **LOW:** Minor cosmetic, developer-experience, or documentation enhancement.

---

## 2. MODULE-BY-MODULE GAP MATRIX

| Module | Current Codebase State | Target Commercial State | Severity | Resolution Action |
|---|---|---|---|---|
| **Media Storage** | Local `FileSystemStorage` (`/media/`). Files written to container disk. | Persistent Object Storage (Cloudflare R2 / S3 via `django-storages`). | **CRITICAL** | Ephemeral container filesystems on Render will delete logos and banners upon container sleep or deploy. Integrate `django-storages[boto3]`. |
| **Stock Expiry Sweeper** | Reserved stock is held indefinitely if customer abandons Razorpay checkout modal. | Scheduled background worker or cron management command releasing unpaid stock after 30-min TTL. | **CRITICAL** | Implement `release_expired_orders` command / scheduled Celery job to prevent permanent inventory starvation. |
| **TiDB Migration State** | Tested only in SQLite `:memory:`; SimpleJWT blacklist migrations not applied to TiDB. | All Django migrations (`accounts`, `stores`, `token_blacklist`) applied cleanly to TiDB Cloud. | **CRITICAL** | Run and verify migrations against staging TiDB before enabling commercial traffic. |
| **Frontend Architecture** | Monolithic single-file `App.tsx` (over 1,500 lines) containing auth, workspace, catalog, and dashboard views. | Feature-sliced modular architecture (`features/auth`, `features/catalog`, `features/orders`, `features/storefront`). | **HIGH** | Refactor React components into discrete files to improve maintainability, tree-shaking, and team concurrency. |
| **Background Processing** | Synchronous HTTP execution for all workflows (Excel imports, Gemini AI queries). | Asynchronous task queue (Celery or Redis Queue) for heavy jobs (bulk XLSX import, email alerts). | **HIGH** | Introduce background worker queue to protect web dyno thread pools from long-running timeouts. |
| **Delivery Integration** | COD payment collection exists, but third-party courier dispatch tracking is manual. | Automated courier API integration (Shiprocket / Delhivery) or structured tracking URLs. | **MEDIUM** | Provide structured courier tracking numbers and carrier selection in order fulfillment. |
| **Customer Profile** | Simple email/username model. Customer delivery addresses stored as JSON inside `Order`. | Dedicated `CustomerAddress` and `CustomerProfile` entities for one-click reorder. | **MEDIUM** | Normalize customer shipping addresses for faster repeat checkouts across stores. |
| **Health Checks** | Standard DRF routes exist, but no dedicated `/api/health/` probe. | Dedicated health check endpoint reporting DB ping, cache status, and version. | **LOW** | Add `/api/health/` route for Render and external uptime monitoring. |

---

## 3. WORKING COMPONENTS TO PRESERVE (DO NOT REWRITE)

The following components represent high-quality, verified engineering work from Phases 1, 2, and 3A that must be preserved:

1. **Razorpay Webhook Verification & Idempotency (`apps.stores.order_views.py`):**
   * Constant-time HMAC-SHA256 signature verification over raw byte streams.
   * Cross-checking `order_id`, exact amount (paise), and currency across both `payment.entity` and `order.entity`.
   * Out-of-order event resilience (updating payment ID if `order.paid` arrives before `payment.captured`).
   * Payment retry safety (`payment.failed` records audit note and retains reserved inventory).
2. **Server-Side Token Revocation & Blacklisting (`apps.accounts.auth.py` / `api_urls.py`):**
   * Working `/api/auth/logout/` blacklisting refresh tokens.
   * Rotation on refresh with immediate revocation of reused tokens.
3. **Protected Product Deletion (`apps.stores.views.py`):**
   * Trapping `ProtectedError` when deleting products referenced in `OrderItem` and returning HTTP 409 Conflict.
4. **Excel Import Engine (`apps.stores.imports.py`):**
   * Two-phase validation (preview dry-run vs transactional commit) with per-row error tracking.
5. **Gemini Facts Grounding (`apps.stores.assistant_service.py`):**
   * Deterministic JSON facts extraction with strict temperature (0.1) and system instructions forbidding hallucinations.
6. **Unique Slug Allocation Engine (`apps.stores.views.py`):**
   * Collisions handled through automated atomic retries and suffix allocation.

---

## 4. TECHNICAL DEBT INVENTORY

1. **Render Free-Tier Cold Starts:**
   * **Problem:** Free Render web services spin down after 15 minutes of inactivity. First request takes 30–50 seconds to boot.
   * **Mitigation:** Setup automated health check pings every 10 minutes via free monitoring tools (UptimeRobot).
2. **Single-File Frontend Complexity (`App.tsx`):**
   * **Problem:** Merging workspace state, theme previews, catalog modals, and router logic into one 96 KB file causes maintenance bottlenecks and high cognitive load.
   * **Mitigation:** Systematic decomposition into discrete React functional components and custom hooks during Phase 4.
3. **TiDB Cloud Driver Purity:**
   * **Strength:** Relying on `PyMySQL` avoids native compilation errors in container environments.
   * **Care Point:** Ensure connection pooling (`CONN_MAX_AGE = 60`, `CONN_HEALTH_CHECKS = True`) remains active to prevent connection exhaustion.
