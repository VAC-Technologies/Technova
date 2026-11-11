
from django.db import IntegrityError, transaction
import logging
from django.db.models import Sum, F, Q, ProtectedError

logger = logging.getLogger('apps.stores')
from django.utils import timezone
from datetime import timedelta
from django.utils.text import slugify

from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Store, Membership, Category, Product, Order
from .serializers import StoreSerializer, StoreAssetSerializer, CategorySerializer, ProductSerializer, PublicProductSerializer


def store_for(user, slug, write=False):
    qs = Store.objects.filter(
        slug=slug,
        memberships__user=user
    )

    if write:
        qs = qs.filter(
            memberships__role__in=['owner', 'admin', 'editor']
        )

    return qs.first()


class StoreViewSet(viewsets.ModelViewSet):
    serializer_class = StoreSerializer

    def get_queryset(self):
        return Store.objects.filter(
            memberships__user=self.request.user
        ).distinct().order_by('pk')

    def perform_create(self, serializer):
        requested_slug = serializer.validated_data.get('slug')
        base = slugify(requested_slug or serializer.validated_data['name'])[:70] or 'store'
        for suffix in range(1, 10000):
            candidate = base if suffix == 1 else f'{base[:70-len(str(suffix))-1]}-{suffix}'
            try:
                with transaction.atomic():
                    store = serializer.save(owner=self.request.user, slug=candidate)
                    Membership.objects.create(store=store, user=self.request.user, role='owner')
                return
            except IntegrityError:
                if Store.objects.filter(slug=candidate).exists():
                    continue
                raise
        raise IntegrityError('Could not allocate a unique store URL slug.')


@api_view(['PATCH', 'POST'])
def store_assets(request, pk):
    store = Store.objects.filter(
        pk=pk,
        memberships__user=request.user,
        memberships__role__in=['owner', 'admin', 'editor'],
    ).distinct().first()
    if not store:
        return Response({'detail': 'Store not found or access denied.'}, status=404)
    if not request.FILES:
        return Response({'detail': 'Upload a logo_image or banner_image file.'}, status=400)
    serializer = StoreAssetSerializer(store, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(StoreSerializer(store, context={'request': request}).data)


@api_view(['GET', 'POST'])
def categories(request, slug):
    store = store_for(
        request.user,
        slug,
        write=request.method == 'POST'
    )

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    if request.method == 'GET':
        data = CategorySerializer(
            store.categories.all(),
            many=True
        ).data
        return Response(data)

    serializer = CategorySerializer(data=request.data, context={'store': store})
    serializer.is_valid(raise_exception=True)
    try:
        serializer.save(store=store)
    except IntegrityError:
        return Response({'name': 'A category with this name already exists in this store.'}, status=400)

    return Response(serializer.data, status=201)


@api_view(['POST'])
def bulk_categories(request, slug):
    """Create multiple categories for a store in one request."""
    store = store_for(request.user, slug, write=True)

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    items = request.data.get('categories')

    if not isinstance(items, list) or not items:
        return Response(
            {
                'categories': [
                    'Provide a non-empty list of categories.'
                ]
            },
            status=400
        )

    # Validate every category before writing anything.
    names = [str(item.get('name', '')).strip().casefold() for item in items if isinstance(item, dict)]
    if len(names) != len(items):
        return Response({'categories': 'Each category must be an object with a name.'}, status=400)
    if len(names) != len(set(names)):
        return Response({'categories': 'Category names must be unique within the request.'}, status=400)
    existing = {name.casefold() for name in store.categories.values_list('name', flat=True)}
    if any(name in existing for name in names):
        return Response({'categories': 'One or more categories already exist in this store.'}, status=400)
    serializer = CategorySerializer(data=items, many=True, context={'store': store})
    serializer.is_valid(raise_exception=True)

    try:
        with transaction.atomic():
            created = serializer.save(store=store)
    except IntegrityError:
        return Response({'categories': 'A category with this name already exists in this store.'}, status=400)

    return Response(
        {
            'created': len(created),
            'categories': CategorySerializer(
                created,
                many=True
            ).data
        },
        status=201
    )


@api_view(['GET', 'POST'])
def products(request, slug):
    store = store_for(
        request.user,
        slug,
        write=request.method == 'POST'
    )

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    if request.method == 'GET':
        data = ProductSerializer(
            store.products.all(),
            many=True,
            context={'store': store}
        ).data
        return Response(data)

    serializer = ProductSerializer(
        data=request.data,
        context={'store': store}
    )
    serializer.is_valid(raise_exception=True)
    try:
        serializer.save(store=store)
    except IntegrityError:
        return Response({'sku': 'A product with this SKU already exists in this store.'}, status=400)

    return Response(serializer.data, status=201)


@api_view(['GET', 'PATCH', 'DELETE'])
def product_detail(request, slug, pk):
    store = store_for(
        request.user,
        slug,
        write=request.method != 'GET'
    )

    product = (
        Product.objects.filter(store=store, pk=pk).first()
        if store else None
    )

    if not product:
        return Response(
            {'detail': 'Product not found.'},
            status=404
        )

    if request.method == 'GET':
        return Response(
            ProductSerializer(
                product,
                context={'store': store}
            ).data
        )

    if request.method == 'DELETE':
        try:
            product.delete()
            logger.info("Product '%s' (ID %s) deleted from store '%s'.", product.name, product.id, store.slug)
            return Response(status=204)
        except ProtectedError:
            logger.warning(
                "Attempted deletion of product '%s' (ID %s) blocked: product is referenced in historical orders.",
                product.name,
                product.id
            )
            return Response(
                {
                    'detail': 'Cannot delete product because it is referenced in existing orders. Consider deactivating it instead.'
                },
                status=409
            )

    serializer = ProductSerializer(
        product,
        data=request.data,
        partial=True,
        context={'store': store}
    )
    serializer.is_valid(raise_exception=True)
    try:
        serializer.save()
    except IntegrityError:
        return Response({'sku': 'A product with this SKU already exists in this store.'}, status=400)

    return Response(serializer.data)


@api_view(['GET', 'PATCH'])
def theme(request, slug):
    store = store_for(
        request.user,
        slug,
        write=request.method == 'PATCH'
    )

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    themes = [
        value
        for value, _ in Store._meta.get_field('theme').choices
    ]

    if request.method == 'GET':
        return Response({
            'themes': themes,
            'selected': store.theme,
            'settings': store.theme_settings
        })

    selected_theme = request.data.get('theme', store.theme)
    settings = request.data.get(
        'theme_settings',
        store.theme_settings
    )

    if selected_theme not in themes or not isinstance(settings, dict):
        return Response(
            {'detail': 'Invalid theme or settings.'},
            status=400
        )

    store.theme = selected_theme
    store.theme_settings = settings
    store.save()

    return Response({
        'theme': selected_theme,
        'theme_settings': settings
    })


@api_view(['POST'])
def publish(request, slug):
    store = store_for(request.user, slug, write=True)

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    store.is_published = True
    store.save(update_fields=['is_published'])

    return Response({
        'slug': store.slug,
        'url_path': '/store/' + store.slug,
        'is_published': True
    })


@api_view(['GET'])
def analytics(request, slug):
    store = store_for(request.user, slug)

    if not store:
        return Response(
            {'detail': 'Store not found or access denied.'},
            status=404
        )

    recent = store.orders.filter(
        is_demo=False,
        created_at__gte=timezone.now() - timedelta(days=30)
    )

    return Response({
        'period_days': 30,
        'revenue': str(
            recent.exclude(status='cancelled')
            .aggregate(value=Sum('total'))['value'] or 0
        ),
        'orders': recent.count(),
        'pending_orders': recent.filter(status=Order.Status.PLACED).count(),
        'low_stock': list(
            store.products.filter(
                is_demo=False,
                stock__lte=F('low_stock_threshold')
            ).values('id', 'name', 'stock')
        )
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def public_store(request, slug):
    store = Store.objects.filter(
        slug=slug,
        is_published=True
    ).first()

    if not store:
        return Response(
            {'detail': 'Store not found.'},
            status=404
        )

    return Response({
        'name': store.name,
        'slug': store.slug,
        'logo': store.logo,
        'banner_url': store.banner_url,
        'contact_email': store.contact_email,
        'phone': store.phone,
        'business_info': store.business_info,
        'theme': store.theme,
        'theme_settings': store.theme_settings,
        'logo_image': request.build_absolute_uri(store.logo_image.url) if store.logo_image else '',
        'banner_image': request.build_absolute_uri(store.banner_image.url) if store.banner_image else '',
        'categories': CategorySerializer(store.categories.filter(is_demo=False), many=True).data,
        'products': PublicProductSerializer(
            store.products.filter(is_active=True, is_demo=False).filter(
                Q(category__isnull=True) | Q(category__is_demo=False)
            ),
            many=True,
            context={'store': store}
        ).data
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def public_product(request, slug, pk):
    store = Store.objects.filter(slug=slug, is_published=True).first()
    product = Product.objects.filter(store=store, pk=pk, is_active=True, is_demo=False).first() if store else None
    if not product:
        return Response({'detail': 'Product not found.'}, status=404)
    if product.category_id and product.category.is_demo:
        return Response({'detail': 'Product not found.'}, status=404)
    return Response(PublicProductSerializer(product, context={'store': store}).data)
