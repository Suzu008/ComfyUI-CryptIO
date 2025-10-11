import os
import json
import random
import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo
import folder_paths
from .keys import _get_keys
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


class SaveImageCryptIO:
    """
    加密图片保存节点，将图片保存为加密的 .png.encrypted 文件
    """

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.prefix_append = ""
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "ComfyUI"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "CryptIO"

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        """
        保存并加密图片
        """
        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
        )
        results = list()

        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            # 添加元数据
            metadata = None
            if prompt is not None or extra_pnginfo is not None:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            # 首先保存为PNG到内存
            from io import BytesIO

            png_buffer = BytesIO()
            img.save(png_buffer, format="PNG", pnginfo=metadata, compress_level=self.compress_level)
            png_data = png_buffer.getvalue()

            # 加密PNG数据
            encrypted_data = encrypt_data(png_data)

            # 保存加密数据到文件
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.png.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            results.append(
                {"filename": file, "subfolder": subfolder, "type": self.type}
            )
            counter += 1

        return {"ui": {"cryptio_images": results}}

class PreviewImageCryptIO:
    """
    加密图片预览节点，类似SaveImage但用于临时预览
    """

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_temp_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "CryptIO"

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        """
        保存并加密图片用于预览
        """
        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
        )
        results = list()

        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            # 添加元数据
            metadata = None
            if prompt is not None or extra_pnginfo is not None:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            # 首先保存为PNG到内存
            from io import BytesIO

            png_buffer = BytesIO()
            img.save(png_buffer, format="PNG", pnginfo=metadata, compress_level=self.compress_level)
            png_data = png_buffer.getvalue()

            # 加密PNG数据
            encrypted_data = encrypt_data(png_data)

            # 保存加密数据到文件
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.png.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            results.append(
                {"filename": file, "subfolder": subfolder, "type": self.type}
            )
            counter += 1

        return {"ui": {"cryptio_images": results}}

def encrypt_data(data: bytes) -> bytes:
    """
    使用混合加密方案加密数据
    """
    # 1. 生成随机 AES 密钥和 IV
    aes_key = os.urandom(32)  # 256-bit key
    iv = os.urandom(12)  # 96-bit IV for GCM
    # 2. 使用 AES-GCM 加密数据
    cipher = Cipher(algorithms.AES(aes_key), modes.GCM(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted_data = encryptor.update(data) + encryptor.finalize()
    tag = encryptor.tag  # type: ignore # 获取认证标签
    # 3. 使用服务端公钥加密 AES 密钥
    public_pem = _get_keys().get("server_public_key")
    public_key = serialization.load_pem_public_key(public_pem, backend=default_backend())  # type: ignore
    encrypted_aes_key = public_key.encrypt(  # type: ignore
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    # 4. 组合数据：[加密的AES密钥长度(4字节)] + [加密的AES密钥] + [IV长度(4字节)] + [IV] + [加密的数据] + [认证标签]
    encrypted_aes_key_length = len(encrypted_aes_key).to_bytes(4, byteorder="big")
    iv_length = len(iv).to_bytes(4, byteorder="big")
    combined = (
        encrypted_aes_key_length
        + encrypted_aes_key
        + iv_length
        + iv
        + encrypted_data
        + tag  # GCM认证标签附加在末尾
    )
    return combined
