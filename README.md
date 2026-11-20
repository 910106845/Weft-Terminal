# Weft Terminal

**WEAVE EVERY CONNECTION** — 串口 · 本地终端 · SSH · 虚拟串口，一个工作台。

![Weft Terminal](docs/weft-terminal.png)

## 功能

- **串口工具**：端口、波特率、校验位、停止位、流控；HEX / ASCII / UTF-8 / GBK 收发，时间戳、自动换行、日志保存、串口指令库与批量发送。
- **本地终端 / SSH 终端**：多标签、命令补全、历史记录；SSH 支持密码、私钥、SSH Agent 认证，以及 SFTP 文件传输。
- **虚拟串口**：一个页面可创建多对虚拟串口；自动回复规则支持整条消息匹配和 `{串口名}`、`{消息}` 模板，端口与规则随页面保存。
- **工作台**：标签按类型分组，可自定义标签配色与卡片背景，亮/暗主题，串口、终端、虚拟口统一管理。

## 技术栈

Electron · React 18 · Vite · xterm.js · node-pty · serialport · ssh2

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build     # 构建渲染进程
npm start         # 构建后启动 Electron
npm run dist      # 打包安装包（macOS dmg / Windows nsis）
```

## 平台说明

- macOS 的虚拟串口是 PTY（`/dev/ttysXXX`），不会被系统串口枚举列出，需要在第三方工具里手动填写路径。
- Windows 的虚拟串口依赖 [com0com](https://sourceforge.net/projects/com0com/) 生成 COM 端口对。

## 数据目录

应用显示名为 Weft Terminal，但内部数据目录仍沿用 `serial-debug`，升级后已有串口配置、指令库和 SSH 会话不会丢失。
