import base64
from .utils import _key_manager
from .utils.crypto_utils import decrypt_data_hybrid


class TextEncrypt:
    """
    客户端加密节点，使用公钥加密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "要加密的文本"}),
                "encrypted": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "encrypted_text")
    FUNCTION = "crypt"
    CATEGORY = "CryptIO"

    def crypt(self, text: str, encrypted):
        """使用公钥加密文本
        在客户端JavaScript中实现，这里只是占位符
        实际加密在前端JavaScript中完成
        """
        try:
            if text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(text[10:])

                # 使用混合解密
                decrypted_data = decrypt_data_hybrid(encrypted_bytes, _key_manager.server_private_key)
                decrypted_text = decrypted_data.decode("utf-8")
                return (decrypted_text, text)
            else:
                raise ValueError("文本不是加密格式")
        except Exception as e:
            print(f"解密错误: {e}")
            return (f"解密错误: {str(e)}",)


class TextDecrypt:
    """
    服务端解密节点，使用私钥解密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
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
        """使用私钥解密文本（支持混合加密格式）"""
        try:
            if encrypted_text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(encrypted_text[10:])

                # 使用混合解密
                decrypted_data = decrypt_data_hybrid(encrypted_bytes, _key_manager.server_private_key)
                decrypted_text = decrypted_data.decode("utf-8")
                return (decrypted_text,)
            else:
                return (encrypted_text,)
        except Exception as e:
            print(f"解密错误: {e}")
            return (f"解密错误: {str(e)}",)
