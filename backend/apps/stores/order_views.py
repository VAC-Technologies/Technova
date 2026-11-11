import hashlib
import hmac
import json
import logging
import re
import uuid
from decimal import Decimal, InvalidOperation

import httpx
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import Order, OrderItem, OrderStatusHistory, Product, Store
from .order_serializers import OrderReadSerializer
from .views import store_for

logger = logging.getLogger(__name__)
RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1'
VALID_TRANSITIONS = {
    Order.Status.PLACED: {Order.Status.CONFIRMED, Order.Status.CANCELLED},
    Order.Status.CONFIRMED: {Order.Status.PROCESSING, Order.Status.CANCELLED},
    Order.Status.PROCESSING: {Order.Status.SHIPPED, Order.Status.CANCELLED},
    Order.Status.SHIPPED: {Order.Status.DELIVERED},
    Order.Status.DELIVERED: set(),
    Order.Status.CANCELLED: set(),
}


def razorpay_ready():
    key = settings.RAZORPAY_KEY_ID
    secret = settings.RAZORPAY_KEY_SECRET
    mode = settings.RAZORPAY_MODE
    if not key or not secret or mode not in ('test', 'live'):
        return False
    expected_prefix = 'rzp_test_' if mode == 'test' else 'rzp_live_'
    return key.startswith(expected_prefix)


def order_payload(order):
    return OrderReadSerializer(order).data


def reserve_stock(order):
    """Reserve current stock exactly once; caller must hold an atomic transaction."""
    items = list(order.items.select_related('product').order_by('product_id'))
    product_ids = [item.product_id for item in items]
    products = {
        product.pk: product
        for product in Product.objects.select_for_update().filter(
            store_id=order.store_id, pk__in=product_ids
        ).order_by('pk')
    }
    if len(products) != len(set(product_ids)):
        return False
    for item in items:
        product = products[item.product_id]
        if not product.is_active or product.stock < item.quantity:
            return False
    for item in items:
        product = products[item.product_id]
        product.stock -= item.quantity
        product.save(update_fields=['stock', 'updated_at'])
    order.stock_reserved = True
    return True


def release_stock(order):
    if not order.stock_reserved:
        return
    items = list(order.items.order_by('product_id'))
    for item in items:
        Product.objects.select_for_update().filter(
            store_id=order.store_id, pk=item.product_id
        ).update(stock=F('stock') + item.quantity)
    order.stock_reserved = False


def get_customer_order(request, order_number, *, lock=False):
    qs = Order.objects.filter(customer=request.user, is_demo=False)
    if lock:
        qs = qs.select_for_update()
    return get_object_or_404(qs, order_number=order_number)


def validate_checkout(request):
    data = request.data
    name = data.get('customer_name')
    phone = data.get('customer_phone')
    address = data.get('delivery_address')
    payment_method = data.get('payment_method')
    raw_items = data.get('items')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 180:
        return None, 'A customer name of 1 to 180 characters is required.'
    if not isinstance(phone, str) or not re.fullmatch(r'\+?[0-9][0-9\s\-]{7,20}', phone.strip()):
        return None, 'Enter a valid phone number.'
    if not isinstance(address, dict) or any(
        not isinstance(address.get(field), str) or not address[field].strip()
        for field in ('line1', 'city', 'postal_code', 'country')
    ):
        return None, 'Delivery address requires line1, city, postal_code and country.'
    if payment_method not in (Order.PaymentMethod.COD, Order.PaymentMethod.RAZORPAY):
        return None, 'Payment method must be cod or razorpay.'
    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 50:
        return None, 'Add between 1 and 50 cart items.'
    items = []
    seen = set()
    for row in raw_items:
        if not isinstance(row, dict):
            return None, 'Each cart item must include product_id and quantity.'
        product_id, quantity = row.get('product_id'), row.get('quantity')
        if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id < 1:
            return None, 'Each cart item must include a valid product_id.'
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 1000:
            return None, 'Each cart quantity must be an integer between 1 and 1000.'
        if product_id in seen:
            return None, 'A product may appear only once in the cart.'
        seen.add(product_id)
        items.append({'product_id': product_id, 'quantity': quantity})
    idem = request.headers.get('Idempotency-Key', '').strip()
    try:
        idem = str(uuid.UUID(idem))
    except (ValueError, AttributeError):
        return None, 'Provide a valid UUID in the Idempotency-Key header.'
    normalized = {
        'store': request.resolver_match.kwargs.get('slug'),
        'customer_name': name.strip(),
        'customer_phone': phone.strip(),
        'delivery_address': {k: v.strip() for k, v in address.items() if isinstance(v, str)},
        'payment_method': payment_method,
        'items': sorted(items, key=lambda item: item['product_id']),
    }
    fingerprint = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return (normalized, items, idem, fingerprint), None


@api_view(['GET'])
@permission_classes([AllowAny])
def checkout_config(request, slug):
    if not Store.objects.filter(slug=slug, is_published=True).exists():
        return Response({'detail': 'Published store not found.'}, status=404)
    try:
        currency = settings.ORDER_CURRENCY.upper()
        if currency != 'INR':
            raise InvalidOperation
        delivery = Decimal(settings.ORDER_DELIVERY_CHARGE).quantize(Decimal('0.01'))
        if delivery < 0:
            raise InvalidOperation
    except (InvalidOperation, TypeError):
        return Response({'detail': 'Store delivery charge is incorrectly configured.'}, status=503)
    return Response({
        'currency': currency,
        'delivery_charge': format(delivery, '.2f'),
        'payment_methods': {
            'cod': True,
            'razorpay': razorpay_ready(),
        },
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
def checkout(request, slug):
    store = Store.objects.filter(slug=slug, is_published=True).first()
    if not store:
        return Response({'detail': 'Published store not found.'}, status=404)
    parsed, error = validate_checkout(request)
    if error:
        return Response({'detail': error}, status=400)
    normalized, items, idem, fingerprint = parsed
    method = normalized['payment_method']
    if method == Order.PaymentMethod.RAZORPAY and not razorpay_ready():
        return Response({'detail': 'Online payment is not configured with Razorpay test credentials. Cash on Delivery remains available.'}, status=503)
    existing = Order.objects.filter(idempotency_key=idem).first()
    if existing:
        if existing.customer_id != request.user.id or existing.store_id != store.id or existing.request_fingerprint != fingerprint:
            return Response({'detail': 'This Idempotency-Key was already used for a different request.'}, status=409)
        return Response(order_payload(existing), status=200)

    try:
        with transaction.atomic():
            existing = Order.objects.select_for_update().filter(idempotency_key=idem).first()
            if existing:
                if existing.customer_id != request.user.id or existing.store_id != store.id or existing.request_fingerprint != fingerprint:
                    return Response({'detail': 'This Idempotency-Key was already used for a different request.'}, status=409)
                return Response(order_payload(existing), status=200)
            products = {
                product.pk: product
                for product in Product.objects.select_for_update().filter(
                    store=store,
                    pk__in=[item['product_id'] for item in items],
                    is_active=True,
                    is_demo=False,
                ).order_by('pk')
            }
            if len(products) != len(items):
                return Response({'detail': 'One or more products are unavailable in this store.'}, status=400)
            for item in items:
                product = products[item['product_id']]
                if product.stock < item['quantity']:
                    return Response({'detail': f'Insufficient stock for {product.name}.'}, status=409)
            subtotal = sum((products[item['product_id']].price * item['quantity'] for item in items), Decimal('0.00'))
            try:
                currency = settings.ORDER_CURRENCY.upper()
                if currency != 'INR':
                    raise InvalidOperation
                delivery_charge = Decimal(settings.ORDER_DELIVERY_CHARGE).quantize(Decimal('0.01'))
            except (InvalidOperation, TypeError):
                return Response({'detail': 'Store delivery charge is incorrectly configured.'}, status=503)
            if delivery_charge < 0:
                return Response({'detail': 'Store delivery charge is incorrectly configured.'}, status=503)
            order = Order.objects.create(
                store=store, customer=request.user,
                status=Order.Status.PLACED, payment_method=method,
                payment_status=Order.PaymentStatus.PENDING,
                customer_name=normalized['customer_name'], customer_phone=normalized['customer_phone'],
                delivery_address=normalized['delivery_address'], subtotal=subtotal,
                delivery_charge=delivery_charge, total=subtotal + delivery_charge,
                currency=currency, idempotency_key=idem,
                request_fingerprint=fingerprint, stock_reserved=True,
            )
            for item in items:
                product = products[item['product_id']]
                product.stock -= item['quantity']
                product.save(update_fields=['stock', 'updated_at'])
                OrderItem.objects.create(
                    order=order, product=product, name=product.name,
                    quantity=item['quantity'], unit_price=product.price,
                )
            OrderStatusHistory.objects.create(
                order=order, from_status='', to_status=Order.Status.PLACED,
                changed_by=request.user, note='Order placed',
            )
    except IntegrityError:
        existing = Order.objects.filter(idempotency_key=idem).first()
        if existing and existing.customer_id == request.user.id and existing.request_fingerprint == fingerprint:
            return Response(order_payload(existing), status=200)
        return Response({'detail': 'Order could not be created safely; retry with a new request key.'}, status=409)
    return Response(order_payload(order), status=201)

checkout.throttle_scope = 'checkout'
if hasattr(checkout, 'cls'):
    checkout.cls.throttle_scope = 'checkout'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_payment(request, order_number):
    if not razorpay_ready():
        return Response({'detail': 'Razorpay test credentials are not configured.'}, status=503)
    try:
        with transaction.atomic():
            order = get_customer_order(request, order_number, lock=True)
            if order.payment_method != Order.PaymentMethod.RAZORPAY:
                return Response({'detail': 'This order does not use Razorpay.'}, status=400)
            if order.payment_status == Order.PaymentStatus.PAID:
                return Response({'detail': 'This order is already paid.'}, status=409)
            if order.razorpay_order_id and order.stock_reserved:
                return Response({
                    'order_number': order.order_number,
                    'razorpay_order_id': order.razorpay_order_id,
                    'key_id': settings.RAZORPAY_KEY_ID,
                    'amount': int(order.total * 100), 'currency': order.currency,
                })
            if not order.stock_reserved and not reserve_stock(order):
                return Response({'detail': 'Stock is no longer available. Refresh the cart and try again.'}, status=409)
            order.payment_status = Order.PaymentStatus.PENDING
            order.save(update_fields=['stock_reserved', 'payment_status', 'updated_at'])
            try:
                response = httpx.post(
                    f'{RAZORPAY_BASE_URL}/orders',
                    auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
                    json={
                        'amount': int(order.total * 100), 'currency': order.currency,
                        'receipt': order.order_number,
                    }, timeout=15.0,
                )
                response.raise_for_status()
                provider_order = response.json()
                provider_id = provider_order.get('id')
                if not isinstance(provider_id, str) or not provider_id.startswith('order_'):
                    raise ValueError('invalid provider order response')
            except (httpx.HTTPError, ValueError):
                release_stock(order)
                order.payment_status = Order.PaymentStatus.FAILED
                order.save(update_fields=['stock_reserved', 'payment_status', 'updated_at'])
                logger.warning('Razorpay order creation failed for local order %s.', order.order_number)
                return Response({'detail': 'Razorpay could not create a payment order. No payment was taken; retry or choose Cash on Delivery.'}, status=502)
            order.razorpay_order_id = provider_id
            order.save(update_fields=['razorpay_order_id', 'updated_at'])
            return Response({
                'order_number': order.order_number,
                'razorpay_order_id': provider_id,
                'key_id': settings.RAZORPAY_KEY_ID,
                'amount': int(order.total * 100), 'currency': order.currency,
            }, status=201)
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_payment(request, order_number):
    payment_id = request.data.get('razorpay_payment_id')
    provider_order_id = request.data.get('razorpay_order_id')
    signature = request.data.get('razorpay_signature')
    if not all(isinstance(value, str) and value for value in (payment_id, provider_order_id, signature)):
        return Response({'detail': 'Payment id, provider order id and signature are required.'}, status=400)
    if not razorpay_ready():
        return Response({'detail': 'Razorpay verification is not configured.'}, status=503)
    try:
        with transaction.atomic():
            order = get_customer_order(request, order_number, lock=True)
            if order.payment_method != Order.PaymentMethod.RAZORPAY or order.razorpay_order_id != provider_order_id:
                return Response({'detail': 'Payment does not match this order.'}, status=400)
            if order.status == Order.Status.CANCELLED or order.payment_status in (Order.PaymentStatus.FAILED, Order.PaymentStatus.CANCELLED):
                return Response({'detail': 'This order is closed and cannot accept a payment.'}, status=409)
            if order.payment_status == Order.PaymentStatus.PAID:
                if order.razorpay_payment_id == payment_id:
                    return Response(order_payload(order), status=200)
                return Response({'detail': 'A different payment is already recorded for this order.'}, status=409)
            if order.razorpay_payment_id and order.razorpay_payment_id != payment_id:
                return Response({'detail': 'A different payment is already recorded for this order.'}, status=409)
            message = f'{provider_order_id}|{payment_id}'.encode()
            expected = hmac.new(settings.RAZORPAY_KEY_SECRET.encode(), message, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                return Response({'detail': 'Payment signature verification failed.'}, status=400)
            try:
                provider_response = httpx.get(
                    f'{RAZORPAY_BASE_URL}/payments/{payment_id}',
                    auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET), timeout=15.0,
                )
                provider_response.raise_for_status()
                payment = provider_response.json()
            except (httpx.HTTPError, ValueError):
                logger.warning('Razorpay payment lookup failed for local order %s.', order.order_number)
                return Response({'detail': 'Could not confirm payment status with Razorpay. Retry verification.'}, status=502)
            expected_amount = int(order.total * 100)
            if payment.get('order_id') != provider_order_id or payment.get('amount') != expected_amount or payment.get('currency') != order.currency:
                return Response({'detail': 'Razorpay payment details do not match the order total.'}, status=400)
            provider_state = payment.get('status')
            if provider_state not in ('authorized', 'captured'):
                return Response({'detail': 'Razorpay has not authorized or captured this payment.'}, status=409)
            order.razorpay_payment_id = payment_id
            order.payment_status = Order.PaymentStatus.PAID if provider_state == 'captured' else Order.PaymentStatus.AUTHORIZED
            order.save(update_fields=['razorpay_payment_id', 'payment_status', 'updated_at'])
            return Response(order_payload(order), status=200)
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def fail_payment(request, order_number):
    try:
        with transaction.atomic():
            order = get_customer_order(request, order_number, lock=True)
            if order.payment_method != Order.PaymentMethod.RAZORPAY:
                return Response({'detail': 'This order does not use Razorpay.'}, status=400)
            if order.payment_status in (Order.PaymentStatus.PAID, Order.PaymentStatus.AUTHORIZED):
                return Response({'detail': 'An authorized payment cannot be marked failed.'}, status=409)
            if order.payment_status == Order.PaymentStatus.FAILED:
                return Response(order_payload(order), status=200)
            release_stock(order)
            order.razorpay_order_id = None
            order.payment_status = Order.PaymentStatus.FAILED
            order.save(update_fields=['stock_reserved', 'razorpay_order_id', 'payment_status', 'updated_at'])
            return Response(order_payload(order), status=200)
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def customer_orders(request):
    orders = Order.objects.filter(customer=request.user, is_demo=False).select_related('store').prefetch_related('items', 'status_history').order_by('-created_at')
    return Response(OrderReadSerializer(orders, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def customer_order_detail(request, order_number):
    order = get_object_or_404(
        Order.objects.filter(customer=request.user, is_demo=False).prefetch_related('items', 'status_history'),
        order_number=order_number,
    )
    return Response(order_payload(order))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_customer_order(request, order_number):
    try:
        with transaction.atomic():
            order = get_customer_order(request, order_number, lock=True)
            if order.status not in (Order.Status.PLACED, Order.Status.CONFIRMED):
                return Response({'detail': 'This order can no longer be cancelled.'}, status=409)
            if order.payment_status in (Order.PaymentStatus.AUTHORIZED, Order.PaymentStatus.PAID):
                return Response({'detail': 'Paid orders require a gateway refund before cancellation; contact the store.'}, status=409)
            old = order.status
            order.status = Order.Status.CANCELLED
            if order.payment_status == Order.PaymentStatus.PENDING:
                order.payment_status = Order.PaymentStatus.CANCELLED
            release_stock(order)
            order.save(update_fields=['status', 'payment_status', 'stock_reserved', 'updated_at'])
            OrderStatusHistory.objects.create(order=order, from_status=old, to_status=order.status, changed_by=request.user, note='Cancelled by customer')
            return Response(order_payload(order))
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def store_orders(request, slug):
    store = store_for(request.user, slug)
    if not store:
        return Response({'detail': 'Store not found or access denied.'}, status=404)
    orders = store.orders.filter(is_demo=False).prefetch_related('items', 'status_history').order_by('-created_at')
    return Response(OrderReadSerializer(orders, many=True).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_order_status(request, slug, order_number):
    store = store_for(request.user, slug, write=True)
    if not store:
        return Response({'detail': 'Store not found or access denied.'}, status=404)
    new_status = request.data.get('status')
    if new_status not in Order.Status.values:
        return Response({'status': 'Choose a valid order status.'}, status=400)
    try:
        with transaction.atomic():
            order = get_object_or_404(Order.objects.select_for_update().filter(store=store, is_demo=False), order_number=order_number)
            if new_status == order.status:
                return Response(order_payload(order))
            if new_status not in VALID_TRANSITIONS[order.status]:
                return Response({'detail': f'Cannot change order from {order.status} to {new_status}.'}, status=409)
            if new_status == Order.Status.CANCELLED:
                if order.payment_status in (Order.PaymentStatus.AUTHORIZED, Order.PaymentStatus.PAID):
                    return Response({'detail': 'Paid orders require a gateway refund before cancellation.'}, status=409)
                release_stock(order)
                if order.payment_status == Order.PaymentStatus.PENDING:
                    order.payment_status = Order.PaymentStatus.CANCELLED
            old = order.status
            order.status = new_status
            order.save(update_fields=['status', 'payment_status', 'stock_reserved', 'updated_at'])
            OrderStatusHistory.objects.create(order=order, from_status=old, to_status=new_status, changed_by=request.user)
            return Response(order_payload(order))
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def collect_cod_payment(request, slug, order_number):
    store = store_for(request.user, slug, write=True)
    if not store:
        return Response({'detail': 'Store not found or access denied.'}, status=404)
    try:
        with transaction.atomic():
            order = get_object_or_404(Order.objects.select_for_update().filter(store=store, is_demo=False), order_number=order_number)
            if order.payment_method != Order.PaymentMethod.COD:
                return Response({'detail': 'Only Cash on Delivery orders can be collected manually.'}, status=400)
            if order.status != Order.Status.DELIVERED:
                return Response({'detail': 'Mark the order delivered before confirming COD collection.'}, status=409)
            if order.payment_status == Order.PaymentStatus.PAID:
                return Response(order_payload(order), status=200)
            if order.payment_status != Order.PaymentStatus.PENDING:
                return Response({'detail': 'This COD payment is not collectable.'}, status=409)
            order.payment_status = Order.PaymentStatus.PAID
            order.save(update_fields=['payment_status', 'updated_at'])
            return Response(order_payload(order))
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=404)


@api_view(['POST'])
@permission_classes([AllowAny])
def razorpay_webhook(request):
    """
    Asynchronous Razorpay webhook confirmation endpoint.
    Verifies HMAC SHA-256 signature using the raw request body.
    Processes payment.captured, order.paid, payment.failed idempotently.
    """
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        logger.error("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured.")
        return Response({'detail': 'Webhook secret is not configured on the server.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    signature = request.headers.get('X-Razorpay-Signature', '').strip()
    if not signature:
        logger.warning("Razorpay webhook received without X-Razorpay-Signature header.")
        return Response({'detail': 'Missing webhook signature header.'}, status=status.HTTP_400_BAD_REQUEST)

    raw_body = request.body
    computed_signature = hmac.new(secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_signature, signature):
        logger.warning("Razorpay webhook signature verification failed.")
        return Response({'detail': 'Invalid webhook signature.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        event_payload = json.loads(raw_body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("Razorpay webhook payload could not be parsed as JSON.")
        return Response({'detail': 'Malformed JSON payload.'}, status=status.HTTP_400_BAD_REQUEST)

    event = event_payload.get('event')
    if not event or not isinstance(event, str):
        return Response({'detail': 'Event name missing from payload.'}, status=status.HTTP_400_BAD_REQUEST)

    payload_data = event_payload.get('payload', {})
    if not isinstance(payload_data, dict):
        return Response({'detail': 'Malformed payload container.'}, status=status.HTTP_400_BAD_REQUEST)

    payment_entity = payload_data.get('payment', {}).get('entity', {})
    order_entity = payload_data.get('order', {}).get('entity', {})

    payment_id = payment_entity.get('id')
    provider_order_id = payment_entity.get('order_id') or order_entity.get('id')
    receipt = order_entity.get('receipt') or payment_entity.get('notes', {}).get('order_number')

    if not provider_order_id and not receipt:
        logger.warning("Razorpay webhook event '%s' lacks order identifiers.", event)
        return Response({'detail': 'Missing order identification in webhook event.'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        order_qs = Order.objects.select_for_update()
        order = None
        if provider_order_id:
            order = order_qs.filter(razorpay_order_id=provider_order_id).first()
        if not order and receipt:
            order = order_qs.filter(order_number=receipt).first()

        if not order:
            logger.warning("Razorpay webhook event '%s' references unknown order (%s / %s).", event, provider_order_id, receipt)
            return Response({'detail': 'Referenced order not found.'}, status=status.HTTP_404_NOT_FOUND)

        # FIX 3: Razorpay Order ID Validation
        # Whenever both incoming provider_order_id and order.razorpay_order_id exist, they must match.
        if provider_order_id and order.razorpay_order_id and order.razorpay_order_id != provider_order_id:
            logger.error(
                "Razorpay webhook order_id mismatch for order %s: payload order_id '%s' != Order.razorpay_order_id '%s'",
                order.order_number, provider_order_id, order.razorpay_order_id
            )
            return Response({'detail': 'Provider order ID mismatch.'}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Payment captured / order paid
        if event in ('payment.captured', 'order.paid'):
            # FIX 4: Amount and Currency Validation
            # Extract amount and currency from payment entity, falling back to order entity
            event_amount = payment_entity.get('amount')
            if event_amount is None:
                event_amount = order_entity.get('amount')

            event_currency = payment_entity.get('currency')
            if not event_currency:
                event_currency = order_entity.get('currency')
            event_currency = (event_currency or '').upper()

            expected_amount = int(order.total * 100)
            expected_currency = order.currency.upper()

            # Ensure financial data is not missing
            if event_amount is None:
                logger.error("Razorpay webhook event '%s' for order %s is missing payment amount.", event, order.order_number)
                return Response({'detail': 'Payment amount missing from webhook payload.'}, status=status.HTTP_400_BAD_REQUEST)

            if not event_currency:
                logger.error("Razorpay webhook event '%s' for order %s is missing payment currency.", event, order.order_number)
                return Response({'detail': 'Payment currency missing from webhook payload.'}, status=status.HTTP_400_BAD_REQUEST)

            # Validate amount and currency against DB order values
            if event_amount != expected_amount:
                logger.error(
                    "Payment amount mismatch for order %s: expected %s, got %s",
                    order.order_number, expected_amount, event_amount
                )
                return Response({'detail': 'Payment amount does not match order total.'}, status=status.HTTP_400_BAD_REQUEST)

            if event_currency != expected_currency:
                logger.error(
                    "Payment currency mismatch for order %s: expected %s, got %s",
                    order.order_number, expected_currency, event_currency
                )
                return Response({'detail': 'Payment currency does not match order currency.'}, status=status.HTTP_400_BAD_REQUEST)

            # FIX 2: Payment ID Recording & Idempotency
            # If order is already marked PAID, ensure payment ID is recorded if previously missing
            if order.payment_status == Order.PaymentStatus.PAID:
                if payment_id and not order.razorpay_payment_id:
                    order.razorpay_payment_id = payment_id
                    order.save(update_fields=['razorpay_payment_id', 'updated_at'])
                    logger.info("Recorded missing payment ID %s for already-paid order %s.", payment_id, order.order_number)
                else:
                    logger.info("Order %s already marked as PAID; idempotent return.", order.order_number)
                return Response({'detail': 'Order is already marked as paid.', 'order_number': order.order_number}, status=status.HTTP_200_OK)

            # Order cancelled prior to capture
            if order.status == Order.Status.CANCELLED:
                logger.critical(
                    "Payment captured for cancelled order %s! Payment ID: %s",
                    order.order_number, payment_id
                )
                order.razorpay_payment_id = payment_id or order.razorpay_payment_id
                order.payment_status = Order.PaymentStatus.PAID
                order.save(update_fields=['razorpay_payment_id', 'payment_status', 'updated_at'])
                OrderStatusHistory.objects.create(
                    order=order,
                    from_status=order.status,
                    to_status=order.status,
                    note=f'Payment {payment_id} captured after cancellation'
                )
                return Response({'detail': 'Order was previously cancelled; payment recorded for review.', 'order_number': order.order_number}, status=status.HTTP_200_OK)

            # Normal success
            if payment_id:
                order.razorpay_payment_id = payment_id
            order.payment_status = Order.PaymentStatus.PAID
            old_status = order.status
            if order.status == Order.Status.PLACED:
                order.status = Order.Status.CONFIRMED
                OrderStatusHistory.objects.create(
                    order=order,
                    from_status=old_status,
                    to_status=Order.Status.CONFIRMED,
                    note='Confirmed via Razorpay webhook'
                )

            # Inventory was already reserved at checkout; do not double-deduct
            order.save(update_fields=['razorpay_payment_id', 'payment_status', 'status', 'updated_at'])
            logger.info("Order %s confirmed and marked PAID via webhook.", order.order_number)
            return Response({'detail': 'Payment recorded successfully.', 'order_number': order.order_number}, status=status.HTTP_200_OK)

        # 2. Payment failed
        # FIX 1: Payment Retry and Inventory Safety
        # In Razorpay, payment.failed denotes an individual payment attempt failure, not an order failure.
        # Customer can retry another card/UPI on the same order. Do NOT release stock or mark order FAILED.
        elif event == 'payment.failed':
            if order.payment_status in (Order.PaymentStatus.PAID, Order.PaymentStatus.AUTHORIZED):
                logger.warning("Received payment.failed for already paid order %s; ignoring.", order.order_number)
                return Response({'detail': 'Order already paid; ignoring failure event.', 'order_number': order.order_number}, status=status.HTTP_200_OK)

            # Record attempt failure in audit log; keep stock reserved for customer retry
            error_desc = payment_entity.get('error_description') or 'Payment attempt failed'
            logger.warning(
                "Payment attempt %s failed for order %s: %s. Keeping stock reserved for retry.",
                payment_id, order.order_number, error_desc
            )
            OrderStatusHistory.objects.create(
                order=order,
                from_status=order.status,
                to_status=order.status,
                note=f"Payment attempt {payment_id or '<unknown>'} failed ({error_desc[:100]}); awaiting retry or expiry."
            )
            return Response({
                'detail': 'Payment attempt failure acknowledged; order remains open for retry.',
                'order_number': order.order_number
            }, status=status.HTTP_200_OK)

        # 3. Other events acknowledged safely
        else:
            logger.info("Acknowledged Razorpay webhook event '%s' for order %s.", event, order.order_number)
            return Response({'detail': f"Event '{event}' acknowledged.", 'order_number': order.order_number}, status=status.HTTP_200_OK)
