"""
testing/ conftest.py — ensures TESTING=1 is set when running tests
from the testing/ subdirectory directly.
"""
import os
os.environ.setdefault("TESTING", "1")
