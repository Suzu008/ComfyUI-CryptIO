from numbers import Number
import os
import json
import base64
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from server import PromptServer
from aiohttp import web

# 密钥存储路径
KEY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "keys")
PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "server_public_key.pem")
PRIVATE_KEY_PATH = os.path.join(KEY_DIR, "server_private_key.pem")

# 确保密钥目录存在
os.makedirs(KEY_DIR, exist_ok=True)


@PromptServer.instance.routes.get("/cryptio/public_key")
async def get_public_key(request):
    if os.path.exists(PUBLIC_KEY_PATH):
        with open(PUBLIC_KEY_PATH, "rb") as f:
            public_key = f.read().decode("utf-8")
        return web.json_response({"public_key": public_key})
    else:
        return web.json_response({"error": "Public key not found"}, status=404)


class KeyGenerator:
    """
    生成RSA密钥对并提供API接口供客户端获取公钥
    """

    def __init__(self):
        self.generate_keys_if_not_exist()

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("public_key",)
    FUNCTION = "generate"
    CATEGORY = "CryptIO"

    def generate_keys_if_not_exist(self):
        """如果密钥不存在，则生成新的密钥对"""
        if not (os.path.exists(PUBLIC_KEY_PATH) and os.path.exists(PRIVATE_KEY_PATH)):
            # 生成RSA密钥对
            private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())

            # 获取公钥
            public_key = private_key.public_key()

            # 将私钥保存到文件
            with open(PRIVATE_KEY_PATH, "wb") as f:
                f.write(
                    private_key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.PKCS8,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )

            # 将公钥保存到文件
            with open(PUBLIC_KEY_PATH, "wb") as f:
                f.write(
                    public_key.public_bytes(encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo)
                )

    def generate(self):
        """返回公钥"""
        with open(PUBLIC_KEY_PATH, "rb") as f:
            public_key = f.read().decode("utf-8")
        return (public_key,)


class ClientEncrypt:
    """
    客户端加密节点，使用公钥加密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "要加密的文本"}),
                "encrypted": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("encrypted_text",)
    FUNCTION = "encrypt"
    CATEGORY = "CryptIO"

    def encrypt(self, text: int, encrypted):
        """使用公钥加密文本"""
        # 在客户端JavaScript中实现，这里只是占位符
        # 实际加密在前端JavaScript中完成
        return (text,)


class ServerDecrypt:
    """
    服务端解密节点，使用私钥解密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "encrypted_text": ("STRING", {"multiline": True, "default": "ENCRYPTED:加密的文本"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("decrypted_text",)
    FUNCTION = "decrypt"
    CATEGORY = "CryptIO"

    def decrypt(self, encrypted_text):
        """使用私钥解密文本"""
        try:
            # 如果前端已经加密，则解密
            if encrypted_text.startswith("ENCRYPTED:"):
                # 移除前缀并解码Base64
                encrypted_bytes = base64.b64decode(encrypted_text[10:])

                # 加载私钥
                with open(PRIVATE_KEY_PATH, "rb") as key_file:
                    private_key = serialization.load_pem_private_key(key_file.read(), password=None, backend=default_backend())

                # 解密数据
                decrypted_bytes = private_key.decrypt(
                    encrypted_bytes, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
                )

                # 解码为字符串
                decrypted_text = decrypted_bytes.decode("utf-8")
                return (decrypted_text,)
            else:
                # 如果未加密，直接返回原始文本
                return (encrypted_text,)
        except Exception as e:
            print(f"解密错误: {e}")
            return (f"解密错误: {str(e)}",)


# 节点映射
NODE_CLASS_MAPPINGS = {
    "KeyGenerator": KeyGenerator,
    "ClientEncrypt": ClientEncrypt,
    "ServerDecrypt": ServerDecrypt,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "KeyGenerator": "密钥生成器",
    "ClientEncrypt": "客户端加密",
    "ServerDecrypt": "服务端解密",
}
