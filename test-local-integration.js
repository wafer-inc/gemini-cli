#!/usr/bin/env node

/**
 * Test script to validate local model integration with Gemini CLI
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing Gemini CLI with Local Model Integration\n');

// Test 1: Check if server can start
console.log('1. Testing local model server startup...');

const serverProcess = spawn('bash', ['-c', 'source local-model-server/venv/bin/activate && python local-model-server/gemma_server.py --host 127.0.0.1 --port 8001'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

let serverStarted = false;
let serverOutput = '';

serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  serverOutput += output;
  console.log('Server:', output.trim());
  
  if (output.includes('Uvicorn running')) {
    serverStarted = true;
    runCliTest();
  }
});

serverProcess.stderr.on('data', (data) => {
  const output = data.toString();
  console.error('Server Error:', output.trim());
});

serverProcess.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// Test 2: Health check
async function testHealthCheck() {
  console.log('\n2. Testing server health check...');
  
  try {
    const response = await fetch('http://localhost:8001/');
    const data = await response.json();
    console.log('✅ Health check passed:', data);
    return true;
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return false;
  }
}

// Test 3: Direct API test
async function testDirectAPI() {
  console.log('\n3. Testing direct API call...');
  
  try {
    const response = await fetch('http://localhost:8001/v1/models/gemma-3n-E4B-it:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello, can you say "Local model is working!" ?' }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 50
        }
      })
    });
    
    const data = await response.json();
    console.log('✅ Direct API test passed:');
    console.log('Response:', data.candidates[0].content.parts[0].text);
    return true;
  } catch (error) {
    console.log('❌ Direct API test failed:', error.message);
    return false;
  }
}

// Test 4: CLI integration test
async function runCliTest() {
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for server to fully start
  
  const healthOk = await testHealthCheck();
  if (!healthOk) {
    cleanup();
    return;
  }
  
  const apiOk = await testDirectAPI();
  if (!apiOk) {
    cleanup();
    return;
  }
  
  console.log('\n4. Testing CLI integration...');
  console.log('To test CLI with local model, run:');
  console.log('');
  console.log('export GEMINI_AUTH_TYPE=local-model');
  console.log('export GEMINI_LOCAL_MODEL_URL=http://localhost:8001');
  console.log('npm run build');
  console.log('gemini --model gemma-3n-E4B-it -p "Hello from local model!"');
  console.log('');
  console.log('Or use the authentication dialog in interactive mode:');
  console.log('gemini');
  console.log('Then select "Local Model" when prompted for authentication.');
  
  cleanup();
}

function cleanup() {
  console.log('\n🧹 Cleaning up...');
  serverProcess.kill();
  process.exit(0);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

setTimeout(() => {
  if (!serverStarted) {
    console.log('❌ Server failed to start within 5 minutes');
    console.log('Server output:', serverOutput);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure you have installed the requirements:');
    console.log('   cd local-model-server && ./setup.sh');
    console.log('2. Make sure you have Python 3.8+ and pip installed');
    console.log('3. Check if the model downloads require more time/space');
    console.log('4. Make sure you have accepted the Gemma license and logged in to HuggingFace');
    cleanup();
  }
}, 300000); // 5 minutes for initial model download