import os
import json
import random
import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths # pyright: ignore[reportMissingImports]
from .utils import _key_manager
from .utils.crypto_utils import encrypt_data_hybrid


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
                "format": (["PNG", "JPG", "WEBP", "AVIF"],),
                "quality": ("INT", {"default": 95, "min": 1, "max": 100, "step": 1}),
                "auto_download": ("BOOLEAN", {"default": False}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "CryptIO🔒"

    def save_images(self, images, filename_prefix="ComfyUI", format="PNG", quality=95, auto_download=False, prompt=None, extra_pnginfo=None):
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

            # 添加元数据 (仅PNG支持)
            metadata = None
            if format == "PNG" and (prompt is not None or extra_pnginfo is not None):
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            # 保存为指定格式到内存
            from io import BytesIO

            file_ext = format.lower()
            if format == "JPG":
                file_ext = "jpg"
                format_key = "JPEG"
            else:
                format_key = format

            buffer = BytesIO()
            if format == "PNG":
                img.save(buffer, format="PNG", pnginfo=metadata, compress_level=self.compress_level)
            else:
                # JPG/WEBP/AVIF ignore metadata for now
                img.save(buffer, format=format_key, quality=quality)
            
            image_data = buffer.getvalue()

            # 加密数据
            encrypted_data = encrypt_data(image_data)

            # 保存加密数据到文件
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.{file_ext}.encrypted"
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
                "format": (["PNG", "JPG", "WEBP", "AVIF"],),
                "quality": ("INT", {"default": 95, "min": 1, "max": 100, "step": 1}),
                "auto_download": ("BOOLEAN", {"default": False}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "CryptIO🔒"

    def save_images(self, images, auto_download=False, filename_prefix="ComfyUI", format="PNG", quality=95, prompt=None, extra_pnginfo=None):
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

            # 添加元数据 (仅PNG支持)
            metadata = None
            if format == "PNG" and (prompt is not None or extra_pnginfo is not None):
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            # 保存为指定格式到内存
            from io import BytesIO

            file_ext = format.lower()
            if format == "JPG":
                file_ext = "jpg"
                format_key = "JPEG"
            else:
                format_key = format

            buffer = BytesIO()
            if format == "PNG":
                img.save(buffer, format="PNG", pnginfo=metadata, compress_level=self.compress_level)
            else:
                img.save(buffer, format=format_key, quality=quality)
            
            image_data = buffer.getvalue()

            # 加密数据
            encrypted_data = encrypt_data(image_data)

            # 保存加密数据到文件
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.{file_ext}.encrypted"
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
    使用混合加密方案加密数据（使用客户端公钥加密）
    """
    # 使用客户端公钥加密（这样只有客户端能解密）
    if not _key_manager.client_public_key:
        raise ValueError("Client public key not found. Please upload an image first to exchange keys.")

    return encrypt_data_hybrid(data, _key_manager.client_public_key)
