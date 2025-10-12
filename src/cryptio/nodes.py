from .key_generator import KeyGenerator
from .text_crypt import TextDecrypt, TextEncrypt
from .upload_image import UploadImageCryptIO
from .save_image import SaveImageCryptIO, PreviewImageCryptIO
from .upload_video import UploadVideoCryptIO
from .save_video import SaveVideoCryptIO, PreviewVideoCryptIO
from . import api as _api  # noqa: F401

# 节点映射
NODE_CLASS_MAPPINGS = {
    "KeyGenerator": KeyGenerator,
    "TextEncrypt": TextEncrypt,
    "TextDecrypt": TextDecrypt,
    "UploadImageCryptIO": UploadImageCryptIO,
    "SaveImageCryptIO": SaveImageCryptIO,
    "PreviewImageCryptIO": PreviewImageCryptIO,
    "UploadVideoCryptIO": UploadVideoCryptIO,
    "SaveVideoCryptIO": SaveVideoCryptIO,
    "PreviewVideoCryptIO": PreviewVideoCryptIO,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "KeyGenerator": "Key Generator🔒",
    "TextEncrypt": "Text Encrypt🔒",
    "TextDecrypt": "Text Decrypt🔒",
    "UploadImageCryptIO": "UploadImage CryptIO🔒",
    "SaveImageCryptIO": "Save Image CryptIO🔒",
    "PreviewImageCryptIO": "Preview Image CryptIO🔒",
    "UploadVideoCryptIO": "Upload Video CryptIO🔒",
    "SaveVideoCryptIO": "Save Video CryptIO🔒",
    "PreviewVideoCryptIO": "Preview Video CryptIO🔒",
}
