from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "ERM ESG Analyzer"
    debug: bool = True

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    openai_model_simple: str = ""  # For factual yes/no questions (e.g. gpt-4.1-nano)
    openai_model_complex: str = ""  # For reasoning questions (e.g. gpt-4.1-mini)
    embedding_model: str = "text-embedding-3-small"

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_key: str = ""

    # Chunking
    chunk_size: int = 500
    chunk_overlap: int = 50

    # Analysis
    max_concurrent_questions: int = 5

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
