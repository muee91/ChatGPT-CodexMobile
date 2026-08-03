#!/bin/zsh
cd "$(dirname "$0")" || exit 1
npm run backend:stop
echo
read "?按回车键关闭此窗口..."
