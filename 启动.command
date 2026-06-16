#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动本地服务…"
if command -v python3 >/dev/null 2>&1 && python3 -c "import http.server" 2>/dev/null; then
  python3 serve.py
elif command -v ruby >/dev/null 2>&1; then
  ruby serve.rb
else
  echo "未找到可用的 Python 或 Ruby，请安装 Xcode 命令行工具后重试。"
  read -r -p "按回车键关闭…"
fi
