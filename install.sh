#!/usr/bin/env bash
# Install ReviewBot skill into ~/.cursor/ (user-level, works across all workspaces)
# Usage: bash install.sh [--dev]
#   --dev  Use symlinks instead of copies (changes propagate instantly)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/reviewbot"
RULES_SRC="$SCRIPT_DIR/rules"
CURSOR_DIR="$HOME/.cursor"

DEV_MODE=false
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
  esac
done

SKILL_TARGET="$CURSOR_DIR/skills/reviewbot"
MODE="$([ "$DEV_MODE" = true ] && echo 'symlinks' || echo 'copy')"
echo "=== ReviewBot Install (global, $MODE) ==="
echo "Source: $SCRIPT_DIR"
echo "Target: $CURSOR_DIR"
echo ""

mkdir -p "$CURSOR_DIR/skills"

# --- Skill installation ---
if [ "$DEV_MODE" = true ]; then
  rm -rf "$SKILL_TARGET"
  ln -sf "$SKILL_SRC" "$SKILL_TARGET"
  mkdir -p "$SKILL_SRC/sessions"
  echo "✓ Skill → $SKILL_TARGET (symlink → $SKILL_SRC)"
else
  SKILL_FILES=(SKILL.md SKILL.cn.md reviewbot-server.mjs review-client.mjs package.json .env.example)
  mkdir -p "$SKILL_TARGET"
  for f in "${SKILL_FILES[@]}"; do
    [ -f "$SKILL_SRC/$f" ] && cp "$SKILL_SRC/$f" "$SKILL_TARGET/$f"
  done
  mkdir -p "$SKILL_TARGET/sessions"

  echo "📦 Installing dependencies..."
  (cd "$SKILL_TARGET" && npm install --production 2>&1 | tail -1)
  echo "✓ Skill → $SKILL_TARGET (copied + deps installed)"
fi

# --- .env initialization ---
ENV_FILE="$SKILL_TARGET/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "━━━ First-time setup: Bot credentials ━━━"
  echo "ReviewBot needs at least one bot platform configured."
  echo "  QQ Bot:  https://q.qq.com/ → 应用管理 → 创建Bot"
  echo "  飞书 Bot: https://open.feishu.cn/ → 开发者后台 → 创建应用"
  echo ""

  if [ -t 0 ]; then
    read -rp "QQBOT_APP_ID (留空跳过): " QQ_ID
    read -rp "QQBOT_APP_SECRET (留空跳过): " QQ_SECRET
    read -rp "FEISHU_APP_ID (留空跳过): " FS_ID
    read -rp "FEISHU_APP_SECRET (留空跳过): " FS_SECRET
    if [ -n "$QQ_ID" ] || [ -n "$FS_ID" ]; then
      cp "$SKILL_SRC/.env.example" "$ENV_FILE"
      [ -n "$QQ_ID" ] && sed -i.bak "s/^QQBOT_APP_ID=.*/QQBOT_APP_ID=$QQ_ID/" "$ENV_FILE"
      [ -n "$QQ_SECRET" ] && sed -i.bak "s/^QQBOT_APP_SECRET=.*/QQBOT_APP_SECRET=$QQ_SECRET/" "$ENV_FILE"
      [ -n "$FS_ID" ] && sed -i.bak "s/^FEISHU_APP_ID=.*/FEISHU_APP_ID=$FS_ID/" "$ENV_FILE"
      [ -n "$FS_SECRET" ] && sed -i.bak "s/^FEISHU_APP_SECRET=.*/FEISHU_APP_SECRET=$FS_SECRET/" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
      echo "✓ .env created at $ENV_FILE"
    else
      echo "⚠ Skipped. Copy .env.example to .env and edit manually"
    fi
  else
    echo "⚠ Non-interactive shell. Create $ENV_FILE manually (see .env.example)"
  fi
fi

# --- Copy User Rule to clipboard ---
RULE_FILE="$RULES_SRC/reviewbot-protocol.mdc"
if [ -f "$RULE_FILE" ]; then
  RULE_CONTENT="$(sed '1,/^---$/{ /^---$/d; /^[^-]/d; /^---$/d; }' "$RULE_FILE" | sed '/^$/N;/^\n$/d')"
  # Try to remove YAML frontmatter: delete lines between first and second ---
  RULE_CONTENT="$(awk 'BEGIN{skip=0} /^---$/{skip++; next} skip<2{next} {print}' "$RULE_FILE")"

  if command -v pbcopy &>/dev/null; then
    echo "$RULE_CONTENT" | pbcopy
    CLIP_OK=true
  elif command -v xclip &>/dev/null; then
    echo "$RULE_CONTENT" | xclip -selection clipboard
    CLIP_OK=true
  elif command -v xsel &>/dev/null; then
    echo "$RULE_CONTENT" | xsel --clipboard --input
    CLIP_OK=true
  else
    CLIP_OK=false
  fi
fi

echo ""
echo "Done!"
echo ""
echo "Start server:  node $SKILL_TARGET/reviewbot-server.mjs"
echo "Submit review: node $SKILL_TARGET/review-client.mjs --summary '...' --timeout 300"
echo ""
printf '\033[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
printf '\033[1;31m⚠️  IMPORTANT: Configure User Rule manually\033[0m\n'
printf '\033[1;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
echo ""
printf '\033[1;31mCursor does not support installing User Rules via CLI.\033[0m\n'
printf '\033[1;31mTo enable the ReviewBot protocol globally:\033[0m\n'
echo ""
printf '  \033[1m1.\033[0m Open Cursor Settings (\033[1mCmd+Shift+J\033[0m / \033[1mCtrl+Shift+J\033[0m)\n'
printf '  \033[1m2.\033[0m Click \033[1mRules\033[0m in the sidebar\n'
printf '  \033[1m3.\033[0m Paste the rule content into \033[1mUser Rules\033[0m\n'
echo ""
if [ "${CLIP_OK:-false}" = true ]; then
  printf '  \033[1;36m✅ Rule content has been copied to your clipboard.\033[0m\n'
  printf '  \033[1;36m   Open Settings → Rules → User Rules and paste (Cmd+V).\033[0m\n'
else
  echo "  📋 Rule content is available at:"
  echo "     $RULES_SRC/reviewbot-protocol.md"
  printf '  \033[1;36m   Copy its content and paste into User Rules.\033[0m\n'
fi
echo ""
