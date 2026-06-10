"""Unit tests for the pure helper functions in app.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import is_model_installed, parse_params_from_id  # noqa: E402


class TestParseParamsFromId:
    def test_simple_b_suffix(self):
        assert parse_params_from_id("meta-llama/Meta-Llama-3-8B-Instruct") == 8.0

    def test_decimal_params(self):
        assert parse_params_from_id("Qwen/Qwen2.5-Coder-1.5B-Instruct") == 1.5

    def test_lowercase_b(self):
        assert parse_params_from_id("some-org/model-7b-chat") == 7.0

    def test_picks_last_size_not_version(self):
        # 'Llama-3' must not be read as 3B when a real size follows.
        assert parse_params_from_id("meta-llama/Llama-3-70B") == 70.0

    def test_million_scale(self):
        assert parse_params_from_id("facebook/opt-350M") == 0.35

    def test_moe_active_params_suffix_ignored(self):
        # 'A1B' is the active-params count; total size (8B) is what memory needs.
        assert parse_params_from_id("LiquidAI/LFM2.5-8B-A1B-GGUF") == 8.0
        assert parse_params_from_id("unsloth/Nemotron-3-Ultra-550B-A55B-GGUF") == 550.0

    def test_no_size_returns_none(self):
        assert parse_params_from_id("org/cool-model-instruct") is None

    def test_empty_returns_none(self):
        assert parse_params_from_id("") is None
        assert parse_params_from_id(None) is None

    def test_does_not_match_mid_word(self):
        # 'Base' should not be parsed as a B-suffix.
        assert parse_params_from_id("org/Base-model") is None


class TestIsModelInstalled:
    def test_exact_base_match(self):
        assert is_model_installed("llama3", ["llama3:latest"])

    def test_no_substring_false_positive(self):
        # llama3.2 must NOT count as llama3 being installed.
        assert not is_model_installed("llama3", ["llama3.2:1b"])

    def test_tagged_command_requires_exact_tag(self):
        assert is_model_installed("qwen2:72b", ["qwen2:72b"])
        assert not is_model_installed("qwen2:72b", ["qwen2:7b"])

    def test_case_insensitive(self):
        assert is_model_installed("Phi3", ["phi3:latest"])

    def test_empty_inputs(self):
        assert not is_model_installed("", ["llama3:latest"])
        assert not is_model_installed(None, ["llama3:latest"])
        assert not is_model_installed("llama3", [])

    def test_hf_repo_command(self):
        cmd = "hf.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF"
        assert is_model_installed(cmd, ["hf.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF:latest"])
