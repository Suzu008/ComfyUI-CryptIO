"""Top-level package for cryptio."""

WEB_DIRECTORY = "./js"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


__author__ = """ComfyUI-CryptoIO"""
__email__ = "thesoup@foxmail.com"
__version__ = "0.0.1"

from .src.cryptio.nodes import NODE_CLASS_MAPPINGS
from .src.cryptio.nodes import NODE_DISPLAY_NAME_MAPPINGS


