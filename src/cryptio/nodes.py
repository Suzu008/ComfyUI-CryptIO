from .text_crypt import TextDecrypt, TextEncrypt
from .upload_image import UploadImageCryptIO
from .save_image import SaveImageCryptIO, PreviewImageCryptIO
from .upload_video import UploadVideoCryptIO
from .save_video import SaveVideoCryptIO, PreviewVideoCryptIO
from . import api as _api  # noqa: F401

# 节点映射 - 按功能分组组织
NODE_CLASS_MAPPINGS = {
    # 文本加解密
    "TextEncrypt": TextEncrypt,
    "TextDecrypt": TextDecrypt,
    
    # 图片处理
    "UploadImageCryptIO": UploadImageCryptIO,
    "SaveImageCryptIO": SaveImageCryptIO,
    "PreviewImageCryptIO": PreviewImageCryptIO,
    
    # 视频处理
    "UploadVideoCryptIO": UploadVideoCryptIO,
    "SaveVideoCryptIO": SaveVideoCryptIO,
    "PreviewVideoCryptIO": PreviewVideoCryptIO,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    # 文本加解密
    "TextEncrypt": "Text Encrypt 🔒",
    "TextDecrypt": "Text Decrypt 🔒",
    
    # 图片处理
    "UploadImageCryptIO": "Upload Image 🔒",
    "SaveImageCryptIO": "Save Image 🔒",
    "PreviewImageCryptIO": "Preview Image 🔒",
    
    # 视频处理 deprecated, now defined in node schema
    # "UploadVideoCryptIO": "Upload Video 🔒",
    # "SaveVideoCryptIO": "Save Video 🔒",
    # "PreviewVideoCryptIO": "Preview Video 🔒",
}
