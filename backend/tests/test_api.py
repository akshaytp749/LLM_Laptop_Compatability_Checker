"""Tests for API exposure and the real-inference benchmark helpers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as app_module  # noqa: E402
from app import CURATED_MODELS, app, benchmark_candidates, tokens_per_sec  # noqa: E402


class TestNoCrossOriginAccess:
    """The API can delete and pull models, so no website may call it cross-origin."""

    def test_no_cors_header_on_get(self):
        res = app.test_client().get("/api/system_stats", headers={"Origin": "https://evil.example"})
        assert "Access-Control-Allow-Origin" not in res.headers

    def test_preflight_for_delete_is_not_approved(self):
        res = app.test_client().options(
            "/api/ollama/delete",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert "Access-Control-Allow-Origin" not in res.headers

    def test_delete_rejects_form_encoded_body(self):
        # A cross-site <form> can POST without a preflight, but only as
        # form/text content types - which must not be read as a model name.
        res = app.test_client().post("/api/ollama/delete", data={"model": "llama3"})
        assert res.status_code == 400

    def test_binds_loopback_by_default(self):
        assert app_module.HOST == "127.0.0.1"


class TestTokensPerSec:
    def test_basic(self):
        assert tokens_per_sec(96, 2_000_000_000) == 48.0

    def test_missing_or_zero_returns_none(self):
        assert tokens_per_sec(None, 1) is None
        assert tokens_per_sec(10, 0) is None
        assert tokens_per_sec(0, 1_000) is None


class TestBenchmarkCandidates:
    INSTALLED = [
        {"name": "big:70b", "size_gb": 40.0},
        {"name": "small:1b", "size_gb": 0.8},
        {"name": "mid:8b", "size_gb": 5.0},
    ]

    def test_smallest_first(self):
        assert benchmark_candidates(self.INSTALLED) == ["small:1b", "mid:8b", "big:70b"]

    def test_requested_goes_first(self):
        assert benchmark_candidates(self.INSTALLED, "big:70b")[0] == "big:70b"

    def test_unknown_request_ignored(self):
        assert benchmark_candidates(self.INSTALLED, "not-installed")[0] == "small:1b"

    def test_limit_and_empty(self):
        assert len(benchmark_candidates(self.INSTALLED, limit=2)) == 2
        assert benchmark_candidates([]) == []


class TestBenchmarkRoute:
    def test_reports_measured_speed(self, monkeypatch):
        monkeypatch.setattr(
            app_module,
            "measure_ollama_speed",
            lambda requested=None: {"model": "small:1b", "tokens_per_sec": 31.5, "tokens": 96, "load_sec": 0.4},
        )
        data = app.test_client().post("/api/benchmark").get_json()
        assert data["measured"]["tokens_per_sec"] == 31.5
        assert 1 <= data["score"] <= 100

    def test_falls_back_when_ollama_is_down(self, monkeypatch):
        monkeypatch.setattr(
            app_module,
            "check_ollama",
            lambda: {"is_installed": False, "is_running": False, "host": "", "installed_models": []},
        )
        data = app.test_client().post("/api/benchmark").get_json()
        assert data["measured"] == {"error": "Ollama is not running"}
        assert "score" in data


def test_curated_models_are_well_formed():
    ids = [m["id"] for m in CURATED_MODELS]
    assert len(ids) == len(set(ids))
    for m in CURATED_MODELS:
        assert m["params_b"] > 0
        # explicit size tag, so "installed" matching can never hit a different size
        assert ":" in m["ollama_cmd"]
