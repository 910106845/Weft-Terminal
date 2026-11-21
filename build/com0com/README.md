# 随包 com0com（可选）

Windows 虚拟串口依赖 [com0com](https://com0com.sourceforge.net/)（GPLv2，内核模式驱动）。

如果希望安装包里自带 com0com：

1. 从 com0com 官方渠道获取安装程序，放到本目录。
2. 文件名使用 `com0com-setup.exe`、`setup.exe` 或 `com0com-installer.exe` 之一。
3. 重新打包。应用会优先使用 `resources/com0com/setupc.exe`，找不到时提示用户运行随包安装程序。

注意：

- com0com 安装驱动需要管理员权限（UAC），无法在普通用户权限下静默完成。
- com0com 使用 GPLv2，分发时请同时附带其许可证和源代码获取方式。
- 建议在 Windows 10 / 11 上验证驱动签名与 Secure Boot 兼容性后再发布。
