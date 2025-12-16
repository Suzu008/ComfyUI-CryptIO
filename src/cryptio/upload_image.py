import os
import hashlib
import numpy as np
import torch
from PIL import Image, ImageSequence, ImageOps
from .utils import _key_manager
from .utils.crypto_utils import decrypt_data_hybrid
import folder_paths  # pyright: ignore[reportMissingImports]
import node_helpers  # pyright: ignore[reportMissingImports]


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
            "required": {"image": (all_files, {"file_upload": True})},
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load_image"
    CATEGORY = "CryptIO🔒"

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

                # 使用服务端私钥解密（混合加密）
                decrypted_data = decrypt_data_hybrid(encrypted_combined, _key_manager.server_private_key)

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
            raise ValueError(f"Failed to decrypt image: {e}")

    @classmethod
    def IS_CHANGED(s, image):
        """检查图片是否已更改"""
        if isinstance(image, str) and not image.startswith("ENCRYPTED:"):
            image_path = folder_paths.get_annotated_filepath(image)
            m = hashlib.sha256()
            with open(image_path, "rb") as f:
                m.update(f.read())
            return m.digest().hex()
        return float("NaN")  # 对于加密数据，总是重新处理

    @classmethod
    def VALIDATE_INPUTS(s, image):
        """验证输入"""
        if isinstance(image, str) and image.endswith(".encrypted"):
            # 加密数据由解密逻辑处理
            # 检查加密文件是否存在
            if image.endswith(".encrypted"):
                if not folder_paths.exists_annotated_filepath(image):
                    return f"Invalid encrypted image file: {image}"
            return True

        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"

        return True
