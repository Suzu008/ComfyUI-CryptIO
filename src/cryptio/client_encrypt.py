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
        """使用公钥加密文本
        在客户端JavaScript中实现，这里只是占位符
        实际加密在前端JavaScript中完成
        """
        return (text,)