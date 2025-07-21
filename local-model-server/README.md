# Gemma 3n E4B Local Model Server

This is a local model server that provides a Gemini API-compatible interface for the Gemma 3n E4B model, designed to work with the Gemini CLI.

## Setup

1. **Install dependencies:**
   ```bash
   ./setup.sh
   ```

2. **Activate the virtual environment:**
   ```bash
   source venv/bin/activate
   ```

3. **Start the server:**
   ```bash
   python gemma_server.py
   ```

   Or with custom options:
   ```bash
   python gemma_server.py --host 0.0.0.0 --port 8080 --reload
   ```

## API Endpoints

The server provides the following endpoints compatible with Google's Gemini API:

- `POST /v1/models/{model_name}:generateContent` - Generate content
- `POST /v1/models/{model_name}:streamGenerateContent` - Stream content generation
- `POST /v1/models/{model_name}:countTokens` - Count tokens
- `POST /v1/models/{model_name}:embedContent` - Generate embeddings (placeholder)
- `GET /v1/models` - List available models
- `GET /` - Health check

## Model Information

- **Model**: google/gemma-3n-E4B-it
- **Capabilities**: Text generation, image-text understanding
- **Device Support**: Apple Silicon MPS, CPU fallback
- **Memory**: Optimized for M2 MacBook with low CPU memory usage

## Testing

You can test the server with curl:

```bash
curl -X POST "http://localhost:8000/v1/models/gemma-3n-E4B-it:generateContent" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "Hello, how are you?"}]
      }
    ],
    "generationConfig": {
      "temperature": 0.7,
      "maxOutputTokens": 100
    }
  }'
```

## Integration with Gemini CLI

This server is designed to work with the Gemini CLI's local model integration. Once running, you can configure the CLI to use:

- **Server URL**: `http://localhost:8000`
- **Auth Type**: `LOCAL_MODEL`
- **Model Name**: `gemma-3n-E4B-it`