"""
Root conftest.py — sets TESTING=1 before any module import so all test
runs (including those launched from subdirectories) use mongomock instead
of a live MongoDB connection.
"""
import os

# Must be set before 'database' module is imported anywhere
os.environ.setdefault("TESTING", "1")
