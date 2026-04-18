"""Generate embeddings for all chunks using OpenAI text-embedding-3-small."""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openai import OpenAI
from app.database import get_supabase
from app.config import get_settings


def main():
    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    sb = get_supabase()

    # Get all chunks without embeddings
    chunks = sb.table("chunks").select("id, content").is_("embedding", "null").order("chunk_index").execute().data

    print(f"Chunks to embed: {len(chunks)}")

    if not chunks:
        print("All chunks already have embeddings!")
        return

    batch_size = 20  # text-embedding-3-small has high TPM limit
    total_batches = (len(chunks) - 1) // batch_size + 1
    embedded = 0

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        batch_num = i // batch_size + 1
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} chunks)...", end=" ", flush=True)

        # Prepare texts (truncate to avoid token limits)
        texts = [c["content"][:8000] for c in batch]

        try:
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=texts,
            )

            # Update each chunk with its embedding
            for j, emb_data in enumerate(response.data):
                chunk_id = batch[j]["id"]
                embedding = emb_data.embedding

                sb.table("chunks").update({
                    "embedding": embedding,
                }).eq("id", chunk_id).execute()

            embedded += len(batch)
            print(f"OK ({embedded}/{len(chunks)})")

        except Exception as e:
            error_str = str(e)
            if "429" in error_str:
                print(f"Rate limit, waiting 30s...")
                time.sleep(30)
                # Retry this batch
                try:
                    response = client.embeddings.create(
                        model="text-embedding-3-small",
                        input=texts,
                    )
                    for j, emb_data in enumerate(response.data):
                        chunk_id = batch[j]["id"]
                        embedding = emb_data.embedding
                        sb.table("chunks").update({
                            "embedding": embedding,
                        }).eq("id", chunk_id).execute()
                    embedded += len(batch)
                    print(f"  Retry OK ({embedded}/{len(chunks)})")
                except Exception as e2:
                    print(f"  Retry failed: {e2}")
            else:
                print(f"Error: {e}")

        # Small delay to avoid rate limits
        time.sleep(0.5)

    print(f"\nDone! Embedded {embedded}/{len(chunks)} chunks")

    # Verify
    count = sb.table("chunks").select("id", count="exact").not_.is_("embedding", "null").execute()
    print(f"Total chunks with embeddings: {count.count}")


if __name__ == "__main__":
    main()
