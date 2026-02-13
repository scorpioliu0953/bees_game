#!/bin/bash

# macOS npm 環境自動偵測與安裝腳本（直接下載 Node.js 官方安裝檔）

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC} $1"; }
step()  { echo -e "${YELLOW}[=>]${NC} $1"; }
fail()  { echo -e "${RED}[ERR]${NC} $1"; }

echo "========================================="
echo " macOS npm 環境自動設定腳本"
echo "========================================="
echo ""

# 1. 偵測晶片架構
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
    NODE_ARCH="arm64"
    info "偵測到 Apple Silicon (arm64)"
else
    NODE_ARCH="x64"
    info "偵測到 Intel (x64)"
fi

# 2. 檢查 Node.js / npm
NODE_VERSION="v22.14.0"  # LTS 版本

if command -v node &>/dev/null && command -v npm &>/dev/null; then
    info "Node.js 已安裝 ($(node --version))"
    info "npm 已安裝 ($(npm --version))"
else
    step "Node.js 未安裝，正在下載官方安裝檔..."

    PKG_NAME="node-${NODE_VERSION}.pkg"
    PKG_URL="https://nodejs.org/dist/${NODE_VERSION}/${PKG_NAME}"
    TMP_PKG="/tmp/${PKG_NAME}"

    # 下載 .pkg 安裝檔
    step "下載中: ${PKG_URL}"
    curl -fSL -o "$TMP_PKG" "$PKG_URL"
    info "下載完成"

    # 執行安裝（需要管理員權限）
    step "正在安裝 Node.js ${NODE_VERSION}（可能需要輸入密碼）..."
    sudo installer -pkg "$TMP_PKG" -target /
    info "Node.js 安裝完成"

    # 清理暫存檔
    rm -f "$TMP_PKG"

    # 重新載入 PATH
    export PATH="/usr/local/bin:$PATH"

    # 驗證安裝
    if command -v node &>/dev/null && command -v npm &>/dev/null; then
        info "Node.js $(node --version) 安裝成功"
        info "npm $(npm --version) 安裝成功"
    else
        fail "安裝後仍找不到 node/npm，請重新開啟終端機再試。"
        exit 1
    fi
fi

# 3. 檢查專案相依套件
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
    echo ""
    step "偵測到 package.json，檢查專案相依套件..."

    if [[ -d "$SCRIPT_DIR/node_modules" ]]; then
        info "node_modules 已存在，執行 npm install 確保套件完整..."
    else
        warn "node_modules 不存在，正在安裝相依套件..."
    fi

    cd "$SCRIPT_DIR"
    npm install
    info "專案相依套件安裝完成"
else
    warn "目前目錄下未找到 package.json，跳過套件安裝。"
fi

# 4. 完成
echo ""
echo "========================================="
echo -e " ${GREEN}環境設定完成！${NC}"
echo "========================================="
echo ""
echo " 可用指令："
echo "   npm run dev      - 啟動開發伺服器"
echo "   npm run build    - 建置專案"
echo "   npm run preview  - 預覽建置結果"
echo ""
