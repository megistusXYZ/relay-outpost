#!/bin/bash
set -e
npm install --prefer-offline --no-audit --no-fund 2>/dev/null || true
