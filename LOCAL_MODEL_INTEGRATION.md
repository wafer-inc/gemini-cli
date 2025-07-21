# Local Model Integration for Gemini CLI

This integration allows you to use a locally hosted Gemma 3n E4B model with the Gemini CLI instead of the Google Gemini API.

## Quick Setup

### 1. Set up Hugging Face Access

First, you need to get access to the Gemma model:

1. Go to https://huggingface.co/google/gemma-3n-E4B-it
2. Sign in to your Hugging Face account (create one if needed)
3. Read and accept the model license
4. Install Hugging Face CLI and log in:

```bash
pip install huggingface_hub[cli]
huggingface-cli login
```

### 2. Install the Local Model Server

```bash
cd local-model-server
./setup.sh
```

### 3. Start the Local Model Server

```bash
cd local-model-server
source venv/bin/activate
python gemma_server.py
```

The server will start on `http://localhost:8000` by default.

### 4. Build the CLI with Local Model Support

```bash
npm run build
```

### 5. Use the CLI with Local Model

#### Option A: Environment Variables
```bash
export GEMINI_AUTH_TYPE=local-model
export GEMINI_LOCAL_MODEL_URL=http://localhost:8000
gemini --model gemma-3n-E4B-it -p "Hello from local model!"
```

#### Option B: CLI Arguments
```bash
gemini --model gemma-3n-E4B-it --local-model-url http://localhost:8000 -p "Hello from local model!"
```

Then when prompted for authentication, select "Local Model".

#### Option C: Interactive Mode
```bash
gemini
```

When the authentication dialog appears, select "Local Model" from the options.

## Configuration Options

### Environment Variables

- `GEMINI_AUTH_TYPE=local-model` - Use local model authentication
- `GEMINI_LOCAL_MODEL_URL` - URL of your local model server (default: http://localhost:8000)
- `GEMINI_LOCAL_MODEL_TIMEOUT` - Request timeout in milliseconds (default: 30000)

### CLI Arguments

- `--local-model-url <url>` - URL of local model server
- `--local-model-timeout <ms>` - Request timeout in milliseconds

## Server Options

The local model server supports the following options:

```bash
python gemma_server.py --help
```

- `--host` - Host to bind to (default: 127.0.0.1)
- `--port` - Port to bind to (default: 8000)
- `--reload` - Enable auto-reload for development

## Testing the Integration

Run the test script to validate everything works:

```bash
node test-local-integration.js
```

## API Compatibility

The local model server implements the following Gemini API endpoints:

- `POST /v1/models/{model}:generateContent` - Generate content
- `POST /v1/models/{model}:streamGenerateContent` - Stream content generation
- `POST /v1/models/{model}:countTokens` - Count tokens
- `POST /v1/models/{model}:embedContent` - Generate embeddings (placeholder)
- `GET /v1/models` - List available models
- `GET /` - Health check

## System Requirements

### For Apple Silicon MacBook (Recommended)
- macOS with Apple Silicon (M1/M2/M3/M4)
- Python 3.8+
- 8GB+ RAM (model runs efficiently with ~3GB GPU RAM)
- ~10GB free disk space for model downloads
- Hugging Face account with accepted Gemma license

### For Other Systems
- Python 3.8+
- 8GB+ RAM minimum
- GPU with CUDA support recommended for better performance
- ~10GB free disk space for model downloads
- Hugging Face account with accepted Gemma license

## Model Information

- **Model**: google/gemma-3n-E4B-it
- **Capabilities**: Multimodal text generation (text, images, video, audio inputs)
- **Parameters**: 8B total, runs with 4B model memory footprint
- **Context Window**: Up to 32K tokens input and output
- **Languages**: Trained on 140+ spoken languages
- **Optimization**: Configured for Apple Silicon MPS with CPU fallback

## Troubleshooting

### Server Won't Start
1. Ensure Python 3.8+ is installed
2. Check that all requirements are installed: `pip install -r local-model-server/requirements.txt`
3. Verify transformers >= 4.53.0: `pip install 'transformers>=4.53.0'`
4. Verify available disk space for model downloads
5. Check for port conflicts on 8000

### Model Access Issues
1. Accept the Gemma license at https://huggingface.co/google/gemma-3n-E4B-it
2. Log in to Hugging Face: `huggingface-cli login`
3. Ensure you have access to the model repository

### CLI Can't Connect
1. Verify server is running: `curl http://localhost:8000/`
2. Check the URL in CLI arguments matches server address
3. Ensure firewall allows local connections

### Model Loading Issues
1. Check available RAM (8GB+ minimum, model uses ~3GB GPU RAM efficiently)
2. Monitor disk space during model download
3. Check server logs for specific errors
4. Verify Hugging Face authentication and model access

### Performance Issues
1. Ensure MPS is available and enabled (Apple Silicon)
2. Consider adjusting `max_new_tokens` for longer responses
3. Monitor memory usage during inference
4. Try reducing image resolution if using multimodal features

## Advanced Usage

### Custom Model Configurations

You can modify `gemma_server.py` to:
- Change generation parameters (temperature, top_p, etc.)
- Implement proper streaming responses
- Add request authentication
- Implement embeddings with a different model
- Add custom preprocessing/postprocessing

### Production Deployment

For production use, consider:
- Running server with proper WSGI server (gunicorn)
- Adding request authentication and rate limiting
- Using a reverse proxy (nginx)
- Implementing proper logging and monitoring
- Setting up model caching strategies

## Contributing

This integration is designed to be extensible. You can:
- Add support for other local models
- Implement additional API endpoints
- Improve streaming responses
- Add model switching capabilities
- Enhance error handling and recovery