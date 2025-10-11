# CryptIO 加密图片上传系统

## 系统架构

本系统实现了端到端的加密图片上传和预览功能，确保图片在客户端加密，在服务器以加密形式存储，只有在使用时才在服务端解密。

## 密钥管理方案

### 密钥分布
- **客户端持有**：
  - 客户端公钥/私钥对
  - 服务端公钥/私钥对（通过加密传输获得）

- **服务端持有**：
  - 服务端公钥/私钥对
  - 客户端公钥

### 密钥交换流程

1. **客户端初始化**：
   - 检查 `localStorage`，如果没有客户端密钥对则生成新的 RSA-2048 密钥对
   - 密钥对保存在 `localStorage` 中（键：`cryptio_client_keypair`）

2. **密钥交换**（`POST /cryptio/exchange_keys`）：
   ```
   客户端 -> 服务器: 发送客户端公钥
   服务器: 1. 保存客户端公钥到 keys.json
          2. 生成随机 AES-256 密钥
          3. 用 AES 加密服务端密钥对（JSON格式）
          4. 用客户端公钥加密 AES 密钥
          5. 返回: {encrypted_aes_key, iv, encrypted_data}
   客户端: 1. 用客户端私钥解密 AES 密钥
          2. 用 AES 密钥解密服务端密钥对
          3. 保存到 localStorage（键：`cryptio_server_keys`）
   ```

3. **密钥缓存**：
   - 客户端密钥对和服务端密钥都缓存在 `localStorage`
   - 下次访问时直接使用缓存，无需重新交换

## 图片上传流程

### 1. 客户端加密上传

```typescript
文件选择 -> 读取文件 -> 混合加密 -> 上传加密数据 -> 服务器存储
```

**混合加密方案**（AES + RSA）：

1. 生成随机 AES-256-GCM 密钥
2. 生成随机 IV（12字节）
3. 用 AES-GCM 加密图片数据
4. 用**服务端公钥**加密 AES 密钥
5. 组合数据格式：
   ```
   [4字节: AES密钥长度] +
   [加密的AES密钥] +
   [4字节: IV长度] +
   [IV] +
   [加密的图片数据]
   ```

### 2. 服务器存储

- 端点：`POST /cryptio/upload_encrypted`
- 接收加密数据，直接保存到 `input/` 目录
- 文件名格式：`cryptio_{uuid}.{ext}.encrypted`
- **文件以完全加密的形式存储在磁盘上**

### 3. 服务端解密（节点执行时）

当 workflow 执行到 `UploadImageCryptIO` 节点时：

1. 从 `input/` 目录读取 `.encrypted` 文件
2. 解析组合数据（AES密钥长度、AES密钥、IV长度、IV、加密数据）
3. 用**服务端私钥**解密 AES 密钥
4. 用 AES-GCM 解密图片数据
5. 转换为 PIL Image 对象
6. 处理并返回 IMAGE tensor 和 MASK tensor

代码位置：`src/cryptio/upload_image.py:48`

## 图片预览流程

### 客户端预览加密图片

```
选择加密图片 -> 请求加密数据 -> 客户端解密 -> 显示预览
```

1. **获取加密数据**：
   - 端点：`GET /cryptio/view_encrypted?filename=xxx.encrypted`
   - 服务器返回 base64 编码的加密文件内容

2. **客户端解密**：
   - 用**服务端私钥**解密 AES 密钥
   - 用 AES 密钥解密图片数据
   - 创建 Blob URL 显示图片

代码位置：`ts/cryptioUploadImage.ts:350`

## 文件结构

### 服务端

```
src/cryptio/
├── keys.py              # 密钥管理
├── api.py               # API端点
│   ├── POST /cryptio/exchange_keys        # 密钥交换
│   ├── POST /cryptio/upload_encrypted     # 上传加密图片
│   ├── GET  /cryptio/view_encrypted       # 获取加密图片
│   └── GET  /cryptio/public_key           # 兼容旧接口
├── upload_image.py      # UploadImageCryptIO节点
└── nodes.py             # 节点注册
```

### 客户端

```
ts/
├── cryptioUploadImage.ts   # 完整的加密上传实现
│   ├── 密钥生成和管理
│   ├── 密钥交换
│   ├── 文件加密/解密
│   ├── 自定义上传widget
│   └── 预览功能
└── clientEncrypt.ts        # 文本加密节点（旧）
```

## 安全特性

1. **端到端加密**：
   - 图片在客户端加密后才上传
   - 服务器存储加密文件
   - 只在节点执行时临时解密

2. **混合加密**：
   - 结合 RSA（非对称）和 AES（对称）的优点
   - RSA 用于密钥交换，AES 用于数据加密
   - 每次上传使用不同的随机 AES 密钥和 IV

3. **密钥安全传输**：
   - 服务端密钥通过客户端公钥加密传输
   - 客户端密钥永不离开客户端

4. **文件级加密**：
   - 加密文件直接存储在磁盘
   - 服务器重启不影响加密数据
   - 无明文缓存

## 使用方法

### 1. 基础使用

1. 在 ComfyUI 中添加 `UploadImageCryptIO` 节点
2. 点击 "choose file to upload" 按钮
3. 选择图片文件
4. 图片自动加密、上传，并显示预览
5. 将节点的 `encrypted` 参数设为 `True`
6. 连接到其他图片处理节点

### 2. 密钥管理

- **重新生成客户端密钥**：清空 localStorage 中的 `cryptio_client_keypair`
- **重新获取服务端密钥**：清空 localStorage 中的 `cryptio_server_keys`
- **服务端重新生成密钥**：删除 `keys/keys.json` 文件，重启 ComfyUI

### 3. 兼容性

- 支持所有标准图片格式（JPEG, PNG, WebP, etc.）
- 支持透明通道和多帧图片
- 输出与标准 `LoadImage` 节点完全兼容

## 技术栈

- **加密算法**：
  - RSA-2048 (OAEP, SHA-256)
  - AES-256-GCM (图片加密)
  - AES-256-CBC (密钥传输)

- **前端**：
  - TypeScript
  - Web Crypto API
  - ComfyUI Extension API

- **后端**：
  - Python 3
  - cryptography library
  - aiohttp

## 性能考虑

- **客户端加密**：现代浏览器的 Web Crypto API 性能优秀
- **文件大小**：加密后文件略大（约增加 300-400 字节的元数据）
- **内存使用**：服务端解密时需要完整加载文件到内存
- **缓存策略**：密钥缓存在 localStorage，避免重复交换

## 故障排查

### 问题：上传失败

- 检查浏览器控制台错误信息
- 确认 `/cryptio/exchange_keys` 端点可访问
- 验证客户端密钥对已生成

### 问题：预览不显示

- 确认文件名以 `.encrypted` 结尾
- 检查服务端私钥是否正确获取
- 查看控制台解密错误信息

### 问题：节点执行失败

- 确认 `encrypted` 参数设为 `True`
- 验证加密文件存在于 `input/` 目录
- 检查服务端私钥是否可用

## 未来改进

- [ ] 支持批量加密上传
- [ ] 添加加密进度显示
- [ ] 支持流式加密（大文件）
- [ ] 密钥轮换机制
- [ ] 加密文件完整性校验
