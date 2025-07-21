#!/bin/bash

# Script to pull wafer.db from Android device using ADB
# Usage: ./scripts/pull-database.sh

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database paths
DEVICE_DB_PATH="/data/local/tmp/wafer.db"
LOCAL_DB_DIR="./database"
LOCAL_DB_PATH="$LOCAL_DB_DIR/wafer.db"

echo -e "${YELLOW}Pulling wafer.db from Android device...${NC}"

# Check if adb is available
if ! command -v adb &> /dev/null; then
    echo -e "${RED}Error: adb command not found. Please install Android SDK Platform Tools.${NC}"
    exit 1
fi

# Check if device is connected
if ! adb devices | grep -q "device$"; then
    echo -e "${RED}Error: No Android device connected or device not authorized.${NC}"
    echo "Please:"
    echo "1. Connect your Android device via USB"
    echo "2. Enable USB debugging in Developer Options"
    echo "3. Authorize the computer on your device"
    exit 1
fi

# Check if database exists on device
if ! adb shell "test -f $DEVICE_DB_PATH"; then
    echo -e "${RED}Error: Database file not found at $DEVICE_DB_PATH on device.${NC}"
    echo "Please ensure the database exists at the specified path."
    exit 1
fi

# Create local database directory if it doesn't exist
mkdir -p "$LOCAL_DB_DIR"

# Backup existing database if it exists
if [ -f "$LOCAL_DB_PATH" ]; then
    BACKUP_PATH="${LOCAL_DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}Backing up existing database to $BACKUP_PATH${NC}"
    mv "$LOCAL_DB_PATH" "$BACKUP_PATH"
fi

# Pull the database
echo -e "${YELLOW}Pulling database from device...${NC}"
if adb pull "$DEVICE_DB_PATH" "$LOCAL_DB_PATH"; then
    echo -e "${GREEN}✓ Successfully pulled wafer.db to $LOCAL_DB_PATH${NC}"
    
    # Show database info
    if command -v sqlite3 &> /dev/null; then
        echo -e "${YELLOW}Database info:${NC}"
        echo "Size: $(du -h "$LOCAL_DB_PATH" | cut -f1)"
        echo "Tables:"
        sqlite3 "$LOCAL_DB_PATH" ".tables" | tr ' ' '\n' | sort | sed 's/^/  - /'
    fi
else
    echo -e "${RED}Error: Failed to pull database from device.${NC}"
    exit 1
fi

echo -e "${GREEN}Database pull completed successfully!${NC}"