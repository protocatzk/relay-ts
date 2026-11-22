#!/usr/bin/env bash
set -euo pipefail

# Generiert Standard-Start- und Pausenscreens im RELAY-Design (PNG & MP4-Loops)
npx tsx scripts/generate-slates.ts
