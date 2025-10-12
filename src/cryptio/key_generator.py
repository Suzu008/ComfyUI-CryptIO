from .utils import _key_manager


class KeyGenerator:
    """
    生成RSA密钥对并提供API接口供客户端获取公钥
    """

    def __init__(self):
        # 密钥会在首次访问 _key_manager 时自动生成
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("public_key",)
    FUNCTION = "generate"
    CATEGORY = "CryptIO"

    def generate(self):
        """返回公钥（使用缓存避免频繁 IO）"""
        public_key = _key_manager.server_public_key_pem.decode("utf-8")
        return (public_key,)