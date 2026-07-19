#!/bin/sh
# Maniac Agent — macOS/Linux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/maniac-agent/main/scripts/install.sh | sh

set -e

REPO="https://github.com/YOUR_ORG/maniac-agent.git"
INSTALL="$HOME/.maniac"
BIN_DIR="$HOME/.local/bin"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
gray()  { printf '\033[90m   %s\033[0m\n' "$*"; }
step()  { printf '\n\033[1m>> %s\033[0m\n' "$*"; }
fail()  { printf '\033[1m   ERROR: %s\033[0m\n' "$*" >&2; exit 1; }

echo ""
bold "  MANIAC — the what the hell agent"
gray "  installing..."
echo ""

# ── Check Node ──────────────────────────────────────────────────────────────

step "Checking Node.js"
if ! command -v node > /dev/null 2>&1; then
    fail "Node.js not found. Install from https://nodejs.org or via nvm: https://github.com/nvm-sh/nvm"
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
    fail "Node.js 18+ required (found $(node --version))"
fi
gray "Node.js $(node --version)"

# ── Check Git ───────────────────────────────────────────────────────────────

step "Checking Git"
command -v git > /dev/null 2>&1 || fail "Git not found. Install via your package manager."
gray "$(git --version)"

# ── Check Yarn ──────────────────────────────────────────────────────────────

step "Checking Yarn"
if ! command -v yarn > /dev/null 2>&1; then
    step "Installing Yarn"
    npm install -g yarn --silent
    gray "Yarn installed"
else
    gray "Yarn $(yarn --version)"
fi

# ── Clone or update ─────────────────────────────────────────────────────────

step "Setting up Maniac"
if [ -d "$INSTALL/maniac-agent/.git" ]; then
    gray "Updating existing install at $INSTALL/maniac-agent"
    git -C "$INSTALL/maniac-agent" pull --quiet
else
    mkdir -p "$INSTALL"
    gray "Cloning into $INSTALL/maniac-agent"
    git clone --depth 1 "$REPO" "$INSTALL/maniac-agent" --quiet
fi

# ── Install dependencies ─────────────────────────────────────────────────────

step "Installing dependencies"
cd "$INSTALL/maniac-agent"
yarn install --frozen-lockfile --silent
gray "Dependencies installed"

# ── Build ────────────────────────────────────────────────────────────────────

step "Building"
yarn build:all --silent
yarn build:cli --silent
gray "Build complete"

# ── Create launcher ──────────────────────────────────────────────────────────

step "Creating maniac command"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/maniac" << EOF
#!/bin/sh
exec node "$INSTALL/maniac-agent/packages/cli/dist/index.js" "\$@"
EOF
chmod +x "$BIN_DIR/maniac"

# ── Add to PATH ──────────────────────────────────────────────────────────────

SHELL_RC=""
case "$SHELL" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    *)      SHELL_RC="$HOME/.profile" ;;
esac

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
    echo "" >> "$SHELL_RC"
    echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$SHELL_RC"
    gray "Added $BIN_DIR to PATH in $SHELL_RC"
else
    gray "PATH already configured"
fi

# ── Setup .env ───────────────────────────────────────────────────────────────

if [ ! -f "$INSTALL/maniac-agent/.env" ]; then
    cp "$INSTALL/maniac-agent/.env.example" "$INSTALL/maniac-agent/.env"
    gray "Created .env at $INSTALL/maniac-agent/.env — add your API keys there"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
bold "  Maniac installed."
echo ""
gray "  Next steps:"
gray "    1. Edit $INSTALL/maniac-agent/.env and add at least one API key (GROQ_API_KEY is free)"
gray "    2. Restart your terminal (or: source $SHELL_RC)"
bold "    3. Run: maniac"
echo ""
