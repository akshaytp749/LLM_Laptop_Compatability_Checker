"""Tests for the thread-safe CPU sampling used by /api/system_stats."""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import system_cpu_percent  # noqa: E402


def test_returns_percentage_in_range():
    system_cpu_percent()  # establish a baseline sample
    time.sleep(0.2)
    value = system_cpu_percent()
    assert 0.0 <= value <= 100.0


def test_works_across_threads():
    # Flask handles each request in a fresh thread; the sampler must still
    # measure against the previous global sample (this is the psutil
    # cpu_percent(interval=None) per-thread pitfall).
    system_cpu_percent()
    time.sleep(0.2)
    with ThreadPoolExecutor(max_workers=1) as pool:
        value = pool.submit(system_cpu_percent).result()
    assert 0.0 <= value <= 100.0
