
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.generics import CreateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
import logging
from django.db import OperationalError, ProgrammingError
from rest_framework_simplejwt.tokens import RefreshToken, TokenError

auth_logger = logging.getLogger('apps.accounts.auth')

from apps.stores import views
from apps.stores.import_views import import_products, product_import_template
from apps.stores.assistant_views import ai_chat
from apps.stores.models import Store
from apps.stores.order_views import (
    cancel_customer_order, checkout, checkout_config, collect_cod_payment, create_payment, customer_order_detail,
    customer_orders, fail_payment, store_orders, update_order_status,
    verify_payment, razorpay_webhook,
)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
        min_length=8
    )

    class Meta:
        model = get_user_model()
        fields = ('id', 'username', 'email', 'password')
        read_only_fields = ('id',)

    def validate(self, attrs):
        user = get_user_model()(
            username=attrs.get('username', ''),
            email=attrs.get('email', '')
        )
        password = attrs.get('password')
        try:
            validate_password(password, user=user)
        except DjangoValidationError as exc:
            raise DRFValidationError({'password': list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return get_user_model().objects.create_user(**validated_data)


class RegisterView(CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth_register'

    def perform_create(self, serializer):
        user = serializer.save()
        auth_logger.info("New user registered successfully: username='%s'", user.username)


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth_login'

    def post(self, request, *args, **kwargs):
        identity = request.data.get('email') or request.data.get('username') or '<unknown>'
        try:
            response = super().post(request, *args, **kwargs)
            if response.status_code == 200:
                auth_logger.info("Successful login for user '%s'", identity)
            else:
                auth_logger.warning("Failed login attempt for user '%s'", identity)
            return response
        except Exception:
            auth_logger.warning("Failed login attempt for user '%s'", identity)
            raise



@api_view(['POST'])
@permission_classes([AllowAny])
def logout_view(request):
    refresh_token = request.data.get('refresh')
    if not refresh_token:
        return Response({'detail': 'Refresh token is required.'}, status=400)
    try:
        token = RefreshToken(refresh_token)
        try:
            token.blacklist()
            auth_logger.info("Refresh token blacklisted successfully.")
        except (OperationalError, ProgrammingError) as db_err:
            auth_logger.error("Token blacklisting database table unavailable: %s", db_err)
        return Response({'detail': 'Successfully logged out.'}, status=200)
    except TokenError:
        auth_logger.warning("Logout failed: invalid or blacklisted refresh token.")
        return Response({'detail': 'Token is invalid or already blacklisted.'}, status=400)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def slug_availability(request):
    slug = request.query_params.get('slug', '').strip()
    if not slug:
        return Response({'detail': 'slug query parameter is required.'}, status=400)
    from django.utils.text import slugify
    normalized = slugify(slug)
    return Response({'slug': normalized, 'available': bool(normalized) and not Store.objects.filter(slug=normalized).exists()})

@api_view(['GET'])
def me(request):
    return Response({
        'id': request.user.id,
        'username': request.user.username,
        'email': request.user.email,
    })


router = DefaultRouter()
router.register('stores', views.StoreViewSet, basename='store')


urlpatterns = [
    path('auth/register/', RegisterView.as_view()),
    path('auth/login/', ThrottledTokenObtainPairView.as_view()),
    path('auth/refresh/', TokenRefreshView.as_view()),
    path('auth/logout/', logout_view),
    path('auth/me/', me),
    path('ai/chat/', ai_chat),
    path('stores/slug-availability/', slug_availability),
    path('stores/<int:pk>/assets/', views.store_assets),
    path('orders/my/', customer_orders),
    path('orders/my/<str:order_number>/', customer_order_detail),
    path('orders/my/<str:order_number>/cancel/', cancel_customer_order),
    path('orders/<str:order_number>/payment/create/', create_payment),
    path('orders/<str:order_number>/payment/verify/', verify_payment),
    path('orders/<str:order_number>/payment/fail/', fail_payment),
    path('payments/razorpay/webhook/', razorpay_webhook, name='razorpay_webhook'),

    path('', include(router.urls)),

    # Categories
    path(
        'stores/<slug:slug>/categories/',
        views.categories
    ),
    path(
        'stores/<slug:slug>/categories/bulk/',
        views.bulk_categories
    ),

    # Products
    path(
        'stores/<slug:slug>/products/',
        views.products
    ),
    path(
        'stores/<slug:slug>/products/import/template/',
        product_import_template
    ),
    path(
        'stores/<slug:slug>/products/import/',
        import_products
    ),
    path(
        'stores/<slug:slug>/products/<int:pk>/',
        views.product_detail
    ),

    # Themes
    path(
        'stores/<slug:slug>/themes/',
        views.theme
    ),
    path(
        'stores/<slug:slug>/theme/',
        views.theme
    ),

    # Publishing and analytics
    path(
        'stores/<slug:slug>/publish/',
        views.publish
    ),
    path(
        'stores/<slug:slug>/analytics/',
        views.analytics
    ),

    # Public store
    path('public/stores/<slug:slug>/checkout/', checkout),
    path('public/stores/<slug:slug>/checkout/config/', checkout_config),
    path('stores/<slug:slug>/orders/', store_orders),
    path('stores/<slug:slug>/orders/<str:order_number>/status/', update_order_status),
    path('stores/<slug:slug>/orders/<str:order_number>/payment/collect/', collect_cod_payment),
    path(
        'public/stores/<slug:slug>/',
        views.public_store
    ),
    path(
        'public/stores/<slug:slug>/products/<int:pk>/',
        views.public_product
    ),
]
