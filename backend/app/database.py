"""Supabase client singleton."""

from functools import lru_cache
from supabase import create_client, Client
from app.config import get_settings


@lru_cache()
def get_supabase() -> Client:
    settings = get_settings()
    service_key = settings.supabase_service_key
    if service_key and not service_key.startswith("your-"):
        key = service_key
    else:
        key = settings.supabase_key
    return create_client(settings.supabase_url, key)
