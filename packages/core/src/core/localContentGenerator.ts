/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  GenerateContentConfig,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';
import { UserTierId } from '../code_assist/types.js';

interface LocalModelConfig {
  baseUrl: string;
  model: string;
  timeout?: number;
}

interface LocalGenerateContentRequest {
  contents: LocalContent[];
  generationConfig?: LocalGenerationConfig;
  systemInstruction?: LocalContent;
  tools?: unknown[];
}

interface LocalContent {
  role: string;
  parts: LocalPart[];
}

interface LocalPart {
  text?: string;
  image?: string;
  functionCall?: Record<string, unknown>;
  functionResponse?: Record<string, unknown>;
}

interface LocalGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
}

interface LocalCandidate {
  content: LocalContent;
  finishReason?: string;
  index?: number;
}

interface LocalUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface LocalGenerateContentResponse {
  candidates: LocalCandidate[];
  usageMetadata?: LocalUsageMetadata;
}

interface LocalCountTokensRequest {
  contents: LocalContent[];
}

interface LocalCountTokensResponse {
  totalTokens: number;
}

interface LocalEmbedContentRequest {
  contents: string[];
  model: string;
}

interface LocalEmbedding {
  values: number[];
}

interface LocalEmbedContentResponse {
  embeddings: LocalEmbedding[];
}

/**
 * ContentGenerator implementation that interfaces with a local model server.
 * Provides compatibility with Google's Gemini API format.
 */
export class LocalContentGenerator implements ContentGenerator {
  private config: LocalModelConfig;

  constructor(config: LocalModelConfig) {
    this.config = {
      timeout: 120000, // 2 minute default timeout for local models
      ...config,
    };
  }

  /**
   * Convert Google GenAI Content format to local server format.
   */
  private convertContentToLocal(content: Content): LocalContent {
    return {
      role: content.role || 'user',
      parts: (content.parts || []).map((part: Part) => {
        const localPart: LocalPart = {};
        
        if (part.text) {
          localPart.text = part.text;
        }
        if (part.inlineData?.data) {
          // Convert inline data to image format the local server expects
          localPart.image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        if (part.functionCall) {
          localPart.functionCall = part.functionCall as Record<string, unknown>;
        }
        if (part.functionResponse) {
          localPart.functionResponse = part.functionResponse as Record<string, unknown>;
        }
        
        return localPart;
      }),
    };
  }

  /**
   * Convert local server response back to Google GenAI format.
   */
  private convertResponseFromLocal(response: LocalGenerateContentResponse): GenerateContentResponse {
    const candidates = response.candidates.map((candidate) => ({
      content: {
        role: candidate.content.role,
        parts: candidate.content.parts.map((part) => {
          const genAIPart: Part = {};
          
          if (part.text) {
            genAIPart.text = part.text;
          }
          if (part.functionCall) {
            genAIPart.functionCall = part.functionCall;
          }
          if (part.functionResponse) {
            genAIPart.functionResponse = part.functionResponse;
          }
          
          return genAIPart;
        }),
      },
      finishReason: candidate.finishReason as any,
      index: candidate.index || 0,
    }));

    const usageMetadata = response.usageMetadata ? {
      promptTokenCount: response.usageMetadata.promptTokenCount,
      candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
      totalTokenCount: response.usageMetadata.totalTokenCount,
    } : undefined;

    // Create the response with computed properties
    const result: GenerateContentResponse = {
      candidates,
      usageMetadata,
      // Add computed properties that the interface expects
      get text() {
        const parts = candidates?.[0]?.content?.parts;
        if (!parts) return undefined;
        const textSegments = parts
          .map((part) => part.text)
          .filter((text): text is string => typeof text === 'string');
        return textSegments.length > 0 ? textSegments.join('') : undefined;
      },
      get data() {
        return candidates?.[0]?.content as any;
      },
      get functionCalls() {
        const parts = candidates?.[0]?.content?.parts;
        if (!parts) return undefined;
        const functionCallParts = parts
          .filter((part) => !!part.functionCall)
          .map((part) => part.functionCall);
        return functionCallParts.length > 0 ? functionCallParts as any : undefined;
      },
      get executableCode() {
        // Local models don't support executable code for now
        return undefined;
      },
      get codeExecutionResult() {
        // Local models don't support code execution for now
        return undefined;
      },
    };

    return result;
  }

  /**
   * Make HTTP request to local model server.
   */
  private async makeRequest(
    endpoint: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    // Combine timeout signal with any provided signal
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage += ` - ${errorData.detail}`;
          }
        } catch {
          // Ignore JSON parsing errors for error responses
        }
        throw new Error(errorMessage);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timed out or was aborted');
        }
        if (error.message.includes('fetch')) {
          throw new Error(`Failed to connect to local model server at ${this.config.baseUrl}: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  async generateContent(
    request: GenerateContentParameters
  ): Promise<GenerateContentResponse> {
    // Normalize contents to array of Content objects
    const contentsArray: Content[] = Array.isArray(request.contents) 
      ? request.contents as Content[]
      : [request.contents as Content];
    
    const localRequest: LocalGenerateContentRequest = {
      contents: contentsArray.map(content => this.convertContentToLocal(content)),
      generationConfig: this.convertGenerationConfig(request.config),
      systemInstruction: request.config?.systemInstruction 
        ? this.convertContentToLocal(request.config.systemInstruction as Content)
        : undefined,
      tools: request.config?.tools,
    };

    const response = await this.makeRequest(
      `/v1/models/${this.config.model}:generateContent`,
      localRequest,
      request.config?.abortSignal
    );

    const localResponse: LocalGenerateContentResponse = await response.json();
    return this.convertResponseFromLocal(localResponse);
  }

  async generateContentStream(
    request: GenerateContentParameters
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // For now, return the full response as a single chunk
    // A proper streaming implementation would parse server-sent events
    const result = await this.generateContent(request);
    
    return (async function* () {
      yield result;
    })();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Normalize contents to array of Content objects
    const contentsArray: Content[] = Array.isArray(request.contents) 
      ? request.contents as Content[]
      : [request.contents as Content];
    
    const localRequest: LocalCountTokensRequest = {
      contents: contentsArray.map(content => this.convertContentToLocal(content)),
    };

    const response = await this.makeRequest(
      `/v1/models/${this.config.model}:countTokens`,
      localRequest
    );

    const localResponse: LocalCountTokensResponse = await response.json();
    return {
      totalTokens: localResponse.totalTokens,
    };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // Normalize contents to array of strings
    const contentsArray: string[] = Array.isArray(request.contents) 
      ? request.contents.map(c => typeof c === 'string' ? c : JSON.stringify(c)) 
      : [typeof request.contents === 'string' ? request.contents : JSON.stringify(request.contents)];
    
    const localRequest: LocalEmbedContentRequest = {
      contents: contentsArray,
      model: request.model || this.config.model,
    };

    const response = await this.makeRequest(
      `/v1/models/${this.config.model}:embedContent`,
      localRequest
    );

    const localResponse: LocalEmbedContentResponse = await response.json();
    return {
      embeddings: localResponse.embeddings.map(embedding => ({
        values: embedding.values,
      })),
    };
  }

  /**
   * Convert GenerateContentConfig to local server format.
   */
  private convertGenerationConfig(config?: GenerateContentConfig): LocalGenerationConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      maxOutputTokens: config.maxOutputTokens,
      candidateCount: config.candidateCount,
      stopSequences: config.stopSequences,
    };
  }

  /**
   * Get user tier (not applicable for local models).
   */
  async getTier?(): Promise<UserTierId | undefined> {
    // Local models don't have tiers, return undefined
    return undefined;
  }
}