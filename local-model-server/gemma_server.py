#!/usr/bin/env python3
"""
Local Gemma 3n E4B model server for Gemini CLI integration.
Provides REST API endpoints that mimic Google's Gemini API format.
"""

import torch
import uvicorn
import warnings
import os
from typing import List, Dict, Any, Optional, AsyncGenerator
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoProcessor, AutoModelForImageTextToText, AutoTokenizer

warnings.filterwarnings('ignore')

# Enable MPS fallback for unsupported operations
os.environ['PYTORCH_ENABLE_MPS_FALLBACK'] = '1'

# Request/Response Models


class TextPart(BaseModel):
    text: str


class ImagePart(BaseModel):
    image: str  # URL or base64


class FunctionCallPart(BaseModel):
    functionCall: Dict[str, Any]


class FunctionResponsePart(BaseModel):
    functionResponse: Dict[str, Any]


class Part(BaseModel):
    text: Optional[str] = None
    image: Optional[str] = None
    functionCall: Optional[Dict[str, Any]] = None
    functionResponse: Optional[Dict[str, Any]] = None


class Content(BaseModel):
    role: str  # 'user', 'model', 'function'
    parts: List[Part]


class GenerationConfig(BaseModel):
    temperature: Optional[float] = 1.0
    topP: Optional[float] = 0.95
    topK: Optional[int] = 64
    maxOutputTokens: Optional[int] = 200
    candidateCount: Optional[int] = 1
    stopSequences: Optional[List[str]] = None


class GenerateContentRequest(BaseModel):
    contents: List[Content]
    generationConfig: Optional[GenerationConfig] = GenerationConfig()
    systemInstruction: Optional[Content] = None
    tools: Optional[List[Dict[str, Any]]] = None


class UsageMetadata(BaseModel):
    promptTokenCount: int
    candidatesTokenCount: int
    totalTokenCount: int


class Candidate(BaseModel):
    content: Content
    finishReason: Optional[str] = "STOP"
    index: Optional[int] = 0


class GenerateContentResponse(BaseModel):
    candidates: List[Candidate]
    usageMetadata: Optional[UsageMetadata] = None


class CountTokensRequest(BaseModel):
    contents: List[Content]


class CountTokensResponse(BaseModel):
    totalTokens: int


class EmbedContentRequest(BaseModel):
    contents: List[str]
    model: str


class Embedding(BaseModel):
    values: List[float]


class EmbedContentResponse(BaseModel):
    embeddings: List[Embedding]


# Global model instance
model = None
processor = None
tokenizer = None
device = None


def get_device():
    """Get the best available device for inference."""
    if torch.backends.mps.is_available():
        device = torch.device("mps")
        print("✅ Using Apple Silicon GPU (MPS)")
    else:
        device = torch.device("cpu")
        print("⚠️ MPS not available, using CPU")
    return device


def load_model():
    """Load the Gemma 3n E4B model."""
    global model, processor, tokenizer, device

    if model is not None:
        return

    print("Loading Gemma 3n E4B model...")
    device = get_device()

    try:
        model_id = "google/gemma-3n-E4B-it"

        # Load tokenizer
        print("Loading tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.padding_side = 'left'  # Important for generation

        # Load processor for multimodal capabilities
        print("Loading processor...")
        processor = AutoProcessor.from_pretrained(model_id)

        # Load model with appropriate settings
        print("Loading model (this may take a few minutes for first-time download)...")

        # Key optimization: Use float32 for MPS stability
        model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            torch_dtype=torch.float32,  # Changed from bfloat16 for MPS
            low_cpu_mem_usage=True,
            trust_remote_code=True,
            # Don't use device_map with MPS
        )

        # Explicitly move to MPS after loading
        if device.type == "mps":
            print("Moving model to MPS...")
            model = model.to(device)

        model.eval()

        # Enable KV cache for faster generation
        if hasattr(model.config, 'use_cache'):
            model.config.use_cache = True

        print("✅ Gemma 3n E4B model loaded successfully!")

        # Warmup inference for better performance
        print("Running warmup inference...")
        warmup_messages = [{
            "role": "user",
            "content": [{"type": "text", "text": "Hello"}]
        }]

        with torch.inference_mode():
            inputs = processor.apply_chat_template(
                warmup_messages,
                add_generation_prompt=True,
                tokenize=True,
                return_tensors="pt"
            ).to(device)

            _ = model.generate(
                inputs,
                max_new_tokens=10,
                do_sample=False,
                use_cache=True,
            )
        print("✅ Warmup complete!")

    except Exception as e:
        print(f"❌ Error loading model: {e}")
        print("Make sure you have:")
        print(
            "1. Accepted the model license at https://huggingface.co/google/gemma-3n-E4B-it")
        print("2. Logged in with `huggingface-cli login`")
        print("3. Updated transformers to version 4.53.0+")
        raise


def estimate_tokens(text: str) -> int:
    """Rough token estimation (1 token ≈ 4 characters)."""
    return max(1, len(text) // 4)


# FastAPI app
app = FastAPI(title="Gemma 3n E4B Local Server", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    """Load the model on startup."""
    load_model()


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "running", "model": "google/gemma-3n-E4B-it"}


@app.post("/v1/models/{model_name}:generateContent")
async def generate_content(
    model_name: str,
    request: GenerateContentRequest
) -> GenerateContentResponse:
    """Generate content using the local model."""
    global model, processor, tokenizer, device

    if model is None or processor is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    try:
        # Convert to proper chat message format
        messages = []

        # Use the same system prompt as Gemini CLI for consistency
        system_text = """You are an interactive CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.

# Core Mandates

- **Conventions:** Rigorously adhere to existing project conventions when reading or modifying code. Analyze surrounding code, tests, and configuration first.
- **Libraries/Frameworks:** NEVER assume a library/framework is available or appropriate. Verify its established usage within the project (check imports, configuration files like 'package.json', 'Cargo.toml', 'requirements.txt', 'build.gradle', etc., or observe neighboring files) before employing it.
- **Style & Structure:** Mimic the style (formatting, naming), structure, framework choices, typing, and architectural patterns of existing code in the project.
- **Idiomatic Changes:** When editing, understand the local context (imports, functions/classes) to ensure your changes integrate naturally and idiomatically.
- **Comments:** Add code comments sparingly. Focus on *why* something is done, especially for complex logic, rather than *what* is done. Only add high-value comments if necessary for clarity or if requested by the user. Do not edit comments that are separate from the code you are changing. *NEVER* talk to the user or describe your changes through comments.
- **Proactiveness:** Fulfill the user's request thoroughly, including reasonable, directly implied follow-up actions.
- **Confirm Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked *how* to do something, explain first, don't just do it.
- **Explaining Changes:** After completing a code modification or file operation *do not* provide summaries unless asked.
- **Path Construction:** Before using any file system tool, you must construct the full absolute path for the file_path argument. Always combine the absolute path of the project's root directory with the file's path relative to the root.
- **Do Not revert changes:** Do not revert changes to the codebase unless asked to do so by the user. Only revert changes made by you if they have resulted in an error or if the user has explicitly asked you to revert the changes.

# Operational Guidelines

## Tone and Style (CLI Interaction)
- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment.
- **Minimal Output:** Aim for fewer than 3 lines of text output (excluding tool use/code generation) per response whenever practical. Focus strictly on the user's query.
- **Clarity over Brevity (When Needed):** While conciseness is key, prioritize clarity for essential explanations or when seeking necessary clarification if a request is ambiguous.
- **No Chitchat:** Avoid conversational filler, preambles ("Okay, I will now..."), or postambles ("I have finished the changes..."). Get straight to the action or answer.
- **Formatting:** Use GitHub-flavored Markdown. Responses will be rendered in monospace.
- **Tools vs. Text:** Use tools for actions, text output *only* for communication. Do not add explanatory comments within tool calls or code blocks unless specifically part of the required code/command itself.
- **Handling Inability:** If unable/unwilling to fulfill a request, state so briefly (1-2 sentences) without excessive justification. Offer alternatives if appropriate.

## Security and Safety Rules
- **Explain Critical Commands:** Before executing commands that modify the file system, codebase, or system state, you *must* provide a brief explanation of the command's purpose and potential impact. Prioritize user understanding and safety.
- **Security First:** Always apply security best practices. Never introduce code that exposes, logs, or commits secrets, API keys, or other sensitive information."""

        if request.systemInstruction:
            # Use provided system instruction from the CLI
            for part in request.systemInstruction.parts:
                if part.text:
                    system_text = part.text
                    break

        messages.append({
            "role": "system",
            "content": [{"type": "text", "text": system_text}]
        })

        # Convert request contents to proper message format
        for content in request.contents:
            message_content = []
            for part in content.parts:
                if part.text:
                    message_content.append({"type": "text", "text": part.text})
                elif part.image:
                    message_content.append(
                        {"type": "image", "image": part.image})

            if message_content:
                messages.append({
                    "role": content.role,
                    "content": message_content
                })

        # Apply chat template and generate
        config = request.generationConfig or GenerationConfig()

        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_tensors="pt",
            return_dict=True,
        )

        # Move all inputs to device
        if device.type == "mps":
            inputs = {k: v.to(device) if isinstance(v, torch.Tensor) else v
                      for k, v in inputs.items()}

        # Generate with the model
        with torch.inference_mode():
            generation_kwargs = {
                "max_new_tokens": config.maxOutputTokens or 200,
                "do_sample": config.temperature != 0 if config.temperature is not None else True,
                "pad_token_id": tokenizer.pad_token_id or tokenizer.eos_token_id,
                "eos_token_id": tokenizer.eos_token_id,
                "use_cache": True,  # Enable KV cache
            }

            # Add attention mask if available
            if "attention_mask" in inputs:
                generation_kwargs["attention_mask"] = inputs["attention_mask"]

            # Set conservative defaults to avoid numerical issues
            temperature = config.temperature if config.temperature is not None else 1.0
            top_p = config.topP if config.topP is not None else 0.95
            top_k = config.topK if config.topK is not None else 50

            # Clamp values to safe ranges
            temperature = max(0.1, min(2.0, temperature))
            top_p = max(0.1, min(1.0, top_p))
            top_k = max(1, min(100, top_k))

            if temperature > 0:
                generation_kwargs.update({
                    "temperature": temperature,
                    "top_p": top_p,
                    "top_k": top_k,
                    "do_sample": True,
                })
            else:
                generation_kwargs["do_sample"] = False

            outputs = model.generate(
                inputs["input_ids"],
                **generation_kwargs
            )

        # Decode only the generated tokens (not the input)
        input_length = inputs["input_ids"].shape[1]
        generated_tokens = outputs[0][input_length:]
        response_text = processor.decode(
            generated_tokens, skip_special_tokens=True)

        # Clean up the response
        response_text = response_text.strip()

        # Remove any remaining chat template artifacts
        if response_text.startswith("model\n"):
            response_text = response_text[6:].strip()
        if response_text.startswith("\n"):
            response_text = response_text.strip()

        # Create response in Gemini API format
        response_content = Content(
            role="model",
            parts=[Part(text=response_text)]
        )

        candidate = Candidate(
            content=response_content,
            finishReason="STOP",
            index=0
        )

        # More accurate token counting
        prompt_tokens = len(tokenizer.encode(str(request.contents)))
        response_tokens = len(tokenizer.encode(response_text))

        usage = UsageMetadata(
            promptTokenCount=prompt_tokens,
            candidatesTokenCount=response_tokens,
            totalTokenCount=prompt_tokens + response_tokens
        )

        return GenerateContentResponse(
            candidates=[candidate],
            usageMetadata=usage
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Generation failed: {str(e)}")


@app.post("/v1/models/{model_name}:streamGenerateContent")
async def stream_generate_content(
    model_name: str,
    request: GenerateContentRequest
):
    """Stream content generation (simplified implementation)."""
    # For now, we'll return the full response as a single chunk
    # A proper streaming implementation would generate tokens incrementally
    response = await generate_content(model_name, request)

    async def generate_stream():
        # Return as a single chunk for simplicity
        chunk = {
            "candidates": [
                {
                    "content": {
                        "parts": response.candidates[0].content.parts[0].model_dump()
                    },
                    "finishReason": response.candidates[0].finishReason
                }
            ]
        }
        yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/plain"
    )


@app.post("/v1/models/{model_name}:countTokens")
async def count_tokens(
    model_name: str,
    request: CountTokensRequest
) -> CountTokensResponse:
    """Count tokens in the provided content."""
    total_tokens = 0

    for content in request.contents:
        for part in content.parts:
            if part.text:
                # Use actual tokenizer for accurate count
                total_tokens += len(tokenizer.encode(part.text))

    return CountTokensResponse(totalTokens=total_tokens)


@app.post("/v1/models/{model_name}:embedContent")
async def embed_content(
    model_name: str,
    request: EmbedContentRequest
) -> EmbedContentResponse:
    """Generate embeddings (placeholder implementation)."""
    # This is a placeholder - Gemma 3n E4B is not primarily an embedding model
    # You might want to use a different model for embeddings or return dummy values
    embeddings = []

    for text in request.contents:
        # Return dummy embedding vector of 768 dimensions (common size)
        dummy_embedding = [0.0] * 768
        embeddings.append(Embedding(values=dummy_embedding))

    return EmbedContentResponse(embeddings=embeddings)


@app.get("/v1/models")
async def list_models():
    """List available models."""
    return {
        "models": [
            {
                "name": "models/gemma-3n-E4B-it",
                "displayName": "Gemma 3n E4B IT",
                "description": "Google's Gemma 3n E4B instruct-tuned model with multimodal capabilities"
            }
        ]
    }

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Start Gemma 3n E4B local server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000,
                        help="Port to bind to")
    parser.add_argument("--reload", action="store_true",
                        help="Enable auto-reload")

    args = parser.parse_args()

    print(f"🚀 Starting Gemma 3n E4B server on http://{args.host}:{args.port}")

    # Set optimal number of threads for M2
    torch.set_num_threads(8)

    uvicorn.run(
        "gemma_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=1,  # Single worker to avoid loading model multiple times
    )
