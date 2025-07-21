#!/bin/bash

echo "=== Testing Local Model Server Performance ==="
echo

echo "1. Testing simple generation (no system prompt)..."
time curl -X POST http://localhost:8000/v1/models/gemma-3n-E4B-it:generateContent \
  -H "Content-Type: application/json" \
  -w "\nTime: %{time_total}s\n" \
  -d '{
    "contents": [
      {
        "role": "user", 
        "parts": [{"text": "Hi"}]
      }
    ],
    "generationConfig": {
      "maxOutputTokens": 3,
      "temperature": 0.1
    }
  }' \
  --silent | jq '.candidates[0].content.parts[0].text // "ERROR"'

echo
echo "2. Testing with very short system prompt..."
time curl -X POST http://localhost:8000/v1/models/gemma-3n-E4B-it:generateContent \
  -H "Content-Type: application/json" \
  -w "\nTime: %{time_total}s\n" \
  -d '{
    "contents": [
      {
        "role": "user", 
        "parts": [{"text": "Hi"}]
      }
    ],
    "systemInstruction": {
      "role": "system",
      "parts": [{"text": "Be helpful."}]
    },
    "generationConfig": {
      "maxOutputTokens": 3,
      "temperature": 0.1
    }
  }' \
  --silent | jq '.candidates[0].content.parts[0].text // "ERROR"'

echo
echo "3. Testing health endpoint..."
time curl -X GET http://localhost:8000/ \
  -w "\nTime: %{time_total}s\n" \
  --silent | jq '.status // "ERROR"'