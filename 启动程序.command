#!/bin/zsh

PROGRAM_DIR="${0:A:h}"
cd "$PROGRAM_DIR" || exit 1

if command -v node >/dev/null 2>&1; then
  OFFER_NODE_BIN="$(command -v node)"
elif [[ -x "/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  OFFER_NODE_BIN="/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  echo "没有找到 Node.js 18 或更高版本。请先安装 Node.js。"
  read "?按回车键关闭窗口。"
  exit 1
fi

(sleep 1; open "http://127.0.0.1:4173") &
"$OFFER_NODE_BIN" server.mjs

