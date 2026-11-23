# AI assistant implementation

The assistant is disabled by default. To enable the OpenAI adapter, configure `AI_ASSISTANT_ENABLED=true`, `AI_ASSISTANT_PROVIDER=openai`, `OPENAI_API_KEY`, and `AI_ASSISTANT_MODEL` on the API host only. Never add the key to `NEXT_PUBLIC_*` variables. The `status` endpoint checks provider credentials against the OpenAI models endpoint; a failed check keeps chat unavailable.

Patients must explicitly grant consent at `/api/patient/ai-assistant/consent`. Each query rechecks current consent before it retrieves context. Withdrawal immediately blocks new requests. Consent stores only the grant/withdrawal timestamps and policy version; chat content is not persisted or logged. API responses are private and no-store.

Context is retrieved using the authenticated user ID and that user's patient profile. The current implementation sends health-information fields, the latest 10 blood-pressure and glucose readings, and metadata for up to 8 owned documents. Original document bytes and OCR text are never retrieved or sent: OCR remains disabled until a reviewed extraction pipeline exists. Answers cite the returned context source list. The provider prompt treats context and questions as untrusted, supports English/Hindi, and prohibits diagnosis and medication advice; model output remains educational and can be wrong.

No model training or fine-tuning occurs. No external medical knowledge corpus is configured, so this is patient-context grounding rather than a curated medical RAG system. Before production, configure the provider account's privacy/retention controls, review applicable data-processing terms, test safety responses, and perform a clinical and privacy review. Do not enable it in production until those reviews and the OpenAI key are in place.
