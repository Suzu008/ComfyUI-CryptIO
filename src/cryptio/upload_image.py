import os
import base64
import hashlib
import numpy as np
import torch
from PIL import Image, ImageSequence, ImageOps
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from .keys import _get_keys
import folder_paths
import node_helpers


class UploadImageCryptIO:
    """
    加密图片上传节点，使用公钥在客户端加密图片数据，服务端使用私钥解密
    """

    def __init__(self):
        self.input_dir = folder_paths.get_input_directory()
        self.type = "input"

    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        encrypted_files = [f for f in files if f.endswith(".encrypted")]
        all_files = sorted(set(encrypted_files))

        return {
            "required": {"image": (all_files, {"image_upload": True})},
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"
    CATEGORY = "CryptIO"

    def load_image(self, image):
        """
        加载并解密图片
        """
        try:
            # 检查是否是加密文件（文件名以 .encrypted 结尾）
            if isinstance(image, str) and image.endswith(".encrypted"):
                # 从加密文件读取
                image_path = folder_paths.get_annotated_filepath(image)

                with open(image_path, "rb") as f:
                    encrypted_combined = f.read()

                # 解析组合数据
                offset = 0

                # 1. 读取加密的AES密钥长度
                encrypted_aes_key_length = int.from_bytes(encrypted_combined[offset : offset + 4], byteorder="big")
                offset += 4

                # 2. 读取加密的AES密钥
                encrypted_aes_key = encrypted_combined[offset : offset + encrypted_aes_key_length]
                offset += encrypted_aes_key_length

                # 3. 读取IV长度
                iv_length = int.from_bytes(encrypted_combined[offset : offset + 4], byteorder="big")
                offset += 4

                # 4. 读取IV
                iv = encrypted_combined[offset : offset + iv_length]
                offset += iv_length

                # 5. 读取加密的数据
                encrypted_data = encrypted_combined[offset:]

                # 6. 使用RSA私钥解密AES密钥
                private_pem = _get_keys().get("server_private_key")
                private_key = serialization.load_pem_private_key(private_pem, password=None, backend=default_backend())  # type: ignore

                aes_key_bytes = private_key.decrypt(  # type: ignore
                    encrypted_aes_key,
                    padding.OAEP(
                        mgf=padding.MGF1(algorithm=hashes.SHA256()),
                        algorithm=hashes.SHA256(),
                        label=None,
                    ),
                )

                # 7. 使用AES密钥解密图片数据
                from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

                cipher = Cipher(algorithms.AES(aes_key_bytes), modes.GCM(iv), backend=default_backend())
                decryptor = cipher.decryptor()

                # 注意：GCM模式需要处理认证标签，它附加在加密数据的末尾
                decrypted_data = decryptor.update(encrypted_data) + decryptor.finalize()

                # 从字节数据创建图片
                from io import BytesIO

                img = Image.open(BytesIO(decrypted_data))

            else:
                return (None, None)

            # 处理图片（与LoadImage节点相同的处理逻辑）
            output_images = []
            output_masks = []
            w, h = None, None

            for i in ImageSequence.Iterator(img):
                i = node_helpers.pillow(ImageOps.exif_transpose, i)

                if i.mode == "I":
                    i = i.point(lambda i: i * (1 / 255))
                image_rgb = i.convert("RGB")

                if len(output_images) == 0:
                    w = image_rgb.size[0]
                    h = image_rgb.size[1]

                if image_rgb.size[0] != w or image_rgb.size[1] != h:
                    continue

                image_array = np.array(image_rgb).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_array)[None,]

                # 处理遮罩
                if "A" in i.getbands():
                    mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                    mask = 1.0 - torch.from_numpy(mask)
                elif i.mode == "P" and "transparency" in i.info:
                    mask = np.array(i.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
                    mask = 1.0 - torch.from_numpy(mask)
                else:
                    mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")

                output_images.append(image_tensor)
                output_masks.append(mask.unsqueeze(0))

            if len(output_images) > 1 and img.format not in ["MPO"]:
                output_image = torch.cat(output_images, dim=0)
                output_mask = torch.cat(output_masks, dim=0)
            else:
                output_image = output_images[0]
                output_mask = output_masks[0]

            return (output_image, output_mask)

        except Exception as e:
            print(f"加载/解密图片错误: {e}")
            # 如果解密失败，尝试正常加载
            image_path = folder_paths.get_annotated_filepath(image)
            img = node_helpers.pillow(Image.open, image_path)

            # 简化的错误处理：返回基本的图片和遮罩
            i = node_helpers.pillow(ImageOps.exif_transpose, img)
            if i.mode == "I":
                i = i.point(lambda i: i * (1 / 255))
            image_rgb = i.convert("RGB")
            image_array = np.array(image_rgb).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_array)[None,]
            mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu").unsqueeze(0)

            return (image_tensor, mask)

    @classmethod
    def IS_CHANGED(s, image, encrypted):
        """检查图片是否已更改"""
        if isinstance(image, str) and not image.startswith("ENCRYPTED:"):
            image_path = folder_paths.get_annotated_filepath(image)
            m = hashlib.sha256()
            with open(image_path, "rb") as f:
                m.update(f.read())
            return m.digest().hex()
        return float("NaN")  # 对于加密数据，总是重新处理

    @classmethod
    def VALIDATE_INPUTS(s, image, encrypted):
        """验证输入"""
        if isinstance(image, str) and (
            image.endswith(".encrypted") or image.startswith("ENCRYPTED_IMAGE:") or image.startswith("ENCRYPTED:")
        ):
            # 加密数据由解密逻辑处理
            # 检查加密文件是否存在
            if image.endswith(".encrypted"):
                if not folder_paths.exists_annotated_filepath(image):
                    return f"Invalid encrypted image file: {image}"
            return True

        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"

        return True
