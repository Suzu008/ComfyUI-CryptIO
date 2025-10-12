"""
加密/解密工具模块
提供数据加密和解密的核心功能
"""

import os
import secrets
from typing import Tuple
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend


def encrypt_data_with_public_key(data: bytes, public_key) -> bytes:
    """
    使用RSA公钥直接加密数据（适用于小数据，最大约190字节）

    Args:
        data: 要加密的数据
        public_key: RSA公钥对象

    Returns:
        加密后的数据
    """
    encrypted = public_key.encrypt(
        data,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return encrypted


def decrypt_data_with_private_key(encrypted_data: bytes, private_key) -> bytes:
    """
    使用RSA私钥直接解密数据

    Args:
        encrypted_data: 加密的数据
        private_key: RSA私钥对象

    Returns:
        解密后的数据
    """
    decrypted = private_key.decrypt(
        encrypted_data,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return decrypted


def encrypt_data_hybrid(data: bytes, public_key) -> bytes:
    """
    使用混合加密方案加密数据（AES-GCM + RSA-OAEP）
    适用于任意大小的数据

    数据格式：
    [加密的AES密钥长度(4字节)] + [加密的AES密钥] + [IV长度(4字节)] + [IV] + [加密的数据]

    Args:
        data: 要加密的数据
        public_key: RSA公钥对象（用于加密AES密钥）

    Returns:
        组合的加密数据
    """
    # 1. 生成随机 AES 密钥和 IV
    aes_key = os.urandom(32)  # 256-bit key
    iv = os.urandom(12)  # 96-bit IV for GCM

    # 2. 使用 AES-GCM 加密数据
    cipher = Cipher(algorithms.AES(aes_key), modes.GCM(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted_data = encryptor.update(data) + encryptor.finalize()
    tag = encryptor.tag  # 获取认证标签

    # 3. 使用RSA公钥加密 AES 密钥
    encrypted_aes_key = encrypt_data_with_public_key(aes_key, public_key)

    # 4. 组合数据
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


def decrypt_data_hybrid(encrypted_combined: bytes, private_key) -> bytes:
    """
    解密混合加密的数据（AES-GCM + RSA-OAEP）

    Args:
        encrypted_combined: 组合的加密数据
        private_key: RSA私钥对象（用于解密AES密钥）

    Returns:
        解密后的原始数据
    """
    offset = 0

    # 1. 读取加密的AES密钥长度
    encrypted_aes_key_length = int.from_bytes(
        encrypted_combined[offset : offset + 4], byteorder="big"
    )
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

    # 5. 读取加密的数据（包含认证标签）
    encrypted_data_with_tag = encrypted_combined[offset:]

    # 6. 使用RSA私钥解密AES密钥
    aes_key = decrypt_data_with_private_key(encrypted_aes_key, private_key)

    # 7. 使用AES密钥解密数据
    # GCM模式：认证标签附加在密文末尾
    tag_length = 16
    encrypted_data = encrypted_data_with_tag[:-tag_length]
    tag = encrypted_data_with_tag[-tag_length:]

    cipher = Cipher(
        algorithms.AES(aes_key), modes.GCM(iv, tag), backend=default_backend()
    )
    decryptor = cipher.decryptor()
    decrypted_data = decryptor.update(encrypted_data) + decryptor.finalize()

    return decrypted_data


def generate_aes_key_and_iv() -> Tuple[bytes, bytes]:
    """
    生成随机的AES密钥和IV

    Returns:
        (aes_key, iv) 元组
    """
    aes_key = secrets.token_bytes(32)  # 256-bit key
    iv = secrets.token_bytes(16)  # 128-bit IV for CBC
    return aes_key, iv


def encrypt_with_aes_cbc(data: bytes, aes_key: bytes, iv: bytes) -> bytes:
    """
    使用AES-CBC模式加密数据（带PKCS7填充）

    Args:
        data: 要加密的数据
        aes_key: AES密钥
        iv: 初始化向量

    Returns:
        加密后的数据
    """
    from cryptography.hazmat.primitives import padding as sym_padding

    # PKCS7 padding
    padder = sym_padding.PKCS7(128).padder()
    padded_data = padder.update(data) + padder.finalize()

    # AES-CBC 加密
    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    encrypted_data = encryptor.update(padded_data) + encryptor.finalize()

    return encrypted_data


def decrypt_with_aes_cbc(encrypted_data: bytes, aes_key: bytes, iv: bytes) -> bytes:
    """
    使用AES-CBC模式解密数据（带PKCS7填充）

    Args:
        encrypted_data: 加密的数据
        aes_key: AES密钥
        iv: 初始化向量

    Returns:
        解密后的数据
    """
    from cryptography.hazmat.primitives import padding as sym_padding

    # AES-CBC 解密
    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded_data = decryptor.update(encrypted_data) + decryptor.finalize()

    # 移除 PKCS7 padding
    unpadder = sym_padding.PKCS7(128).unpadder()
    data = unpadder.update(padded_data) + unpadder.finalize()

    return data
