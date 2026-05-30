"""Top-level package for cryptio."""

from comfy_api.latest import ComfyExtension, io

from .src.cryptio.nodes import NODE_CLASS_MAPPINGS as _NODE_CLASS_MAPPINGS

WEB_DIRECTORY = "./js"
__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]


__author__ = """ComfyUI-CryptoIO"""
__email__ = "thesoup@foxmail.com"
__version__ = "0.0.1"


class CryptIOExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return list(_NODE_CLASS_MAPPINGS.values())


async def comfy_entrypoint() -> CryptIOExtension:
    return CryptIOExtension()
