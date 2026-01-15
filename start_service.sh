#!/bin/bash

# Resolving the execution path
cd "$(dirname "$0")"

# Load local quill environment into path
export PATH="$(pwd)/../quill/.venv/bin:$PATH"

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use the version specified in .nvmrc if it exists, or default
if [ -f ".nvmrc" ]; then
    nvm use
else
    nvm use default
fi

# Run the application
exec make start
