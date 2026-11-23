# 随包 com0com

Windows 虚拟串口依赖 [com0com](https://sourceforge.net/projects/com0com/) 3.0.0.0（GPLv2，内核模式驱动）。

本目录内容会随 Windows 安装包复制到 `resources/com0com/`：

- `com0com-setup.exe`：官方 x64 签名安装程序
- `LICENSE.txt`：GPLv2 许可证
- `SOURCE.txt`：上游地址、版本与校验值

安装流程：

1. 首次创建虚拟串口且系统未安装 com0com 时，卡片会显示「安装 com0com」。
2. 点击后运行随包安装程序（需要管理员权限 / UAC）。
3. 安装完成后回到虚拟串口页面，点击「重试」。

注意：该驱动为 2017 年签名的 Windows 7 版本，Windows 10 可正常使用；部分 Windows 11 / Secure Boot 环境可能遇到驱动签名限制（Code 52），需要在目标机器上验证。
