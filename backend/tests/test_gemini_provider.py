from types import SimpleNamespace

import pytest
from google.genai import types

from app.core.config import Settings
from app.schemas.verification import GeminiAssessment, VerificationVerdict
from app.services.gemini_provider import GeminiProvider, GeminiProviderError, PROMPT_VERSION, SYSTEM_INSTRUCTION


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes):
        self.models = FakeModels(outcomes)
        self.closed = False

    def close(self):
        self.closed = True


def _assessment(verdict="SUPPORTED", evidence_id="evidence-1", relation="DIRECT_SUPPORT", excerpt="Reduced scores by 20%."):
    return {
        "verdict": verdict,
        "explanation": "The abstract reports the same measured reduction.",
        "evidence_assessments": [{"evidence_id": evidence_id, "relation": relation,
                                  "excerpt": excerpt, "rationale": "This sentence addresses the outcome."}],
        "limitations": [],
        "confidence_score": 0.72,
    }


def test_gemini_provider_requests_structured_output_and_validates_pydantic():
    client = FakeClient([SimpleNamespace(text=__import__("json").dumps(_assessment()), parsed=None)])
    settings = Settings(_env_file=None, gemini_api_key="test-key", gemini_model="mock-model")
    provider = GeminiProvider(settings, client)
    value = provider.assess({"claim_text_untrusted_data": "not a real fact"})
    assert value.verdict is VerificationVerdict.SUPPORTED
    call = client.models.calls[0]
    assert call["model"] == "mock-model"
    assert isinstance(call["config"], types.GenerateContentConfig)
    assert call["config"].response_mime_type == "application/json"
    assert call["config"].response_schema is GeminiAssessment
    assert "untrusted quoted data" in call["config"].system_instruction
    assert call["config"].tools is None
    assert call["config"].http_options.retry_options.attempts == 1
    assert '"claim_text_untrusted_data":"not a real fact"' in call["contents"]
    assert PROMPT_VERSION == "verification-v1"
    assert "Do not browse" in SYSTEM_INSTRUCTION


def test_provider_accepts_sdk_parsed_dict_and_rejects_invalid_output():
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"), FakeClient([SimpleNamespace(parsed=_assessment(), text=None)]))
    assert provider.assess({}).verdict == "SUPPORTED"
    invalid = _assessment()
    invalid["confidence_score"] = 1.2
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"), FakeClient([SimpleNamespace(parsed=invalid, text=None)]))
    with pytest.raises(GeminiProviderError, match="invalid assessment"):
        provider.assess({})


def test_provider_retries_transient_rate_limit_but_not_quota(monkeypatch):
    delays = []
    monkeypatch.setattr("app.services.gemini_provider.time.sleep", delays.append)
    class ApiError(Exception):
        code = 429
        message = "rate limit reached"
    client = FakeClient([ApiError("private response"), SimpleNamespace(parsed=_assessment(), text=None)])
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test", gemini_retry_attempts=1), client)
    assert provider.assess({}).verdict == "SUPPORTED"
    assert len(client.models.calls) == 2 and delays == [0.25]

    class QuotaError(Exception):
        code = 429
        message = "RESOURCE_EXHAUSTED: quota exceeded"
    client = FakeClient([QuotaError("secret key not shown")])
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test", gemini_retry_attempts=3), client)
    with pytest.raises(GeminiProviderError) as error:
        provider.assess({})
    assert error.value.kind == "quota_exhausted"
    assert str(error.value) == "Gemini quota is exhausted."
    assert len(client.models.calls) == 1


def test_provider_classifies_unavailable_model_and_timeout(monkeypatch):
    class ModelError(Exception):
        code = 404
        message = "model not available"
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test"), FakeClient([ModelError()]))
    with pytest.raises(GeminiProviderError) as error:
        provider.assess({})
    assert error.value.kind == "model_unavailable"

    monkeypatch.setattr("app.services.gemini_provider.time.sleep", lambda _delay: None)
    provider = GeminiProvider(Settings(_env_file=None, gemini_api_key="test", gemini_retry_attempts=0), FakeClient([TimeoutError()]))
    with pytest.raises(GeminiProviderError) as error:
        provider.assess({})
    assert error.value.kind == "timeout"


def test_provider_requires_environment_key():
    with pytest.raises(GeminiProviderError) as error:
        GeminiProvider(Settings(_env_file=None, gemini_api_key=""))
    assert error.value.kind == "not_configured"
