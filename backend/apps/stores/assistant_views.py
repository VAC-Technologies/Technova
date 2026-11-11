import logging

import httpx
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from django.conf import settings
from google.genai import errors as genai_errors
from .models import Store, Membership
from .assistant_service import inventory_facts, answer_inventory_question

logger = logging.getLogger(__name__)

@api_view(['POST'])
@throttle_classes([ScopedRateThrottle])
def ai_chat(request):
    question = request.data.get('question')
    slug = request.data.get('store_slug')
    if not isinstance(question, str) or not question.strip() or len(question) > 500:
        return Response({'detail': 'Question must contain 1 to 500 characters.'}, status=400)
    if not isinstance(slug, str) or len(slug) > 80:
        return Response({'detail': 'A valid store_slug is required.'}, status=400)
    store = Store.objects.filter(
        slug=slug, memberships__user=request.user
    ).distinct().first()
    if not store:
        return Response({'detail': 'Store not found or access denied.'}, status=404)
    if not settings.GEMINI_API_KEY or not settings.GEMINI_MODEL:
        return Response({'detail': 'AI assistant is not configured.'}, status=503)
    facts = inventory_facts(store)
    try:
        answer = answer_inventory_question(question.strip(), facts)
    except RuntimeError as exc:
        if str(exc) == 'assistant_not_configured':
            return Response({'detail': 'AI assistant is not configured.'}, status=503)
        return Response({'detail': 'AI service returned no usable answer.'}, status=502)
    except genai_errors.APIError as exc:
        code = getattr(exc, 'code', None)
        logger.warning('Gemini API request failed (APIError, status=%s).', code)
        if code == 429:
            return Response({'detail': 'AI service is rate limited. Retry shortly.'}, status=429)
        if code == 504:
            return Response({'detail': 'Gemini accepted the request but exceeded its response deadline. Retry shortly or check Gemini service status.'}, status=504)
        if code in (401, 403, 404):
            return Response({'detail': 'Configured AI model or credentials are unavailable.'}, status=503)
        return Response({'detail': 'AI service is temporarily unavailable.'}, status=502)
    except httpx.TimeoutException as exc:
        logger.warning('Gemini API request timed out (%s).', type(exc).__name__)
        return Response({'detail': 'Gemini did not respond before the 15 second timeout. Retry shortly.'}, status=504)
    except httpx.ConnectError as exc:
        logger.warning('Gemini API connection failed (%s).', type(exc).__name__)
        return Response({'detail': 'The Django server could not connect to Gemini. Check outbound network access and proxy/firewall settings.'}, status=502)
    except Exception as exc:
        # Log only the exception class. Provider exception text can include request
        # details, so never write it (or prompt/store data) to server logs.
        logger.error('Unexpected Gemini assistant failure (%s).', type(exc).__name__)
        return Response({'detail': 'AI service is temporarily unavailable.'}, status=502)
    return Response({'answer': answer, 'store_slug': store.slug, 'evidence': facts})

ai_chat.throttle_scope = 'ai_chat'
if hasattr(ai_chat, 'cls'):
    ai_chat.cls.throttle_scope = 'ai_chat'
