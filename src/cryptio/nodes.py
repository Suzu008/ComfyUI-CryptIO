from .key_generator import KeyGenerator
from .client_encrypt import ClientEncrypt
from .server_decrypt import ServerDecrypt
from .upload_image import UploadImageCryptIO
from . import api as _api  # noqa: F401











# 节点映射
NODE_CLASS_MAPPINGS = {
    "KeyGenerator": KeyGenerator,
    "ClientEncrypt": ClientEncrypt,
    "ServerDecrypt": ServerDecrypt,
    "UploadImageCryptIO": UploadImageCryptIO,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "KeyGenerator": "密钥生成器",
    "ClientEncrypt": "客户端加密",
    "ServerDecrypt": "服务端解密",
    "UploadImageCryptIO": "加密图片上传",
}
