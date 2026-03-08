#!/usr/bin/env node

/**
 * Debug script to test full ACP communication with kiro-cli including prompts
 */

const { spawn } = require('child_process');

console.log('Starting kiro-cli ACP agent...');

// Start the kiro-cli agent
const agent = spawn('/Users/massi/.local/bin/kiro-cli', ['acp'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let messageId = 1;
let currentSessionId = null;
let agentResponseText = '';
let isCollectingResponse = false;

// Function to send JSON-RPC message
function sendMessage(method, params = {}) {
  const message = {
    jsonrpc: "2.0",
    id: messageId++,
    method: method,
    params: params
  };
  
  const messageStr = JSON.stringify(message) + '\n';
  console.log(`\n>>> Sending: ${messageStr.trim()}`);
  
  agent.stdin.write(messageStr);
}

// Handle agent stdout (responses)
agent.stdout.on('data', (data) => {
  const messages = data.toString().trim().split('\n');
  messages.forEach(msg => {
    if (msg.trim()) {
      console.log(`<<< Received: ${msg}`);
      try {
        const parsed = JSON.parse(msg);
        if (parsed.error) {
          console.log(`    Error: ${parsed.error.message} (code: ${parsed.error.code})`);
        } else if (parsed.result) {
          console.log(`    Result:`, JSON.stringify(parsed.result, null, 2));
          
          // Store session ID if this is a session/new response
          if (parsed.result.sessionId && !currentSessionId) {
            currentSessionId = parsed.result.sessionId;
            console.log(`    >>> Stored session ID: ${currentSessionId}`);
          }
          
          // Check if this is the end of the session/prompt response
          if (parsed.result.stopReason === 'end_turn') {
            isCollectingResponse = false;
            console.log('\n' + '='.repeat(80));
            console.log('COMPLETE AGENT RESPONSE:');
            console.log('='.repeat(80));
            console.log(agentResponseText);
            console.log('='.repeat(80));
            agentResponseText = '';
          }
        } else if (parsed.method) {
          console.log(`    Method Call: ${parsed.method}`);
          if (parsed.params) {
            // Handle streaming message chunks specially
            if (parsed.method === 'session/update' && 
                parsed.params.update && 
                parsed.params.update.sessionUpdate === 'agent_message_chunk') {
              
              const chunk = parsed.params.update.content;
              if (chunk && chunk.type === 'text' && chunk.text) {
                if (!isCollectingResponse) {
                  isCollectingResponse = true;
                  console.log('\n📝 AGENT IS RESPONDING (streaming):');
                  console.log('-'.repeat(50));
                }
                agentResponseText += chunk.text;
                console.log(`CHUNK: "${chunk.text}"`);
              }
            } else {
              // Show other parameters normally
              console.log(`    Params:`, JSON.stringify(parsed.params, null, 2));
            }
          }
          
          // Handle file operation requests from the agent
          if (parsed.method === 'fs/read_text_file') {
            console.log(`    >>> Agent requesting to read file: ${parsed.params?.path}`);
            // Send a mock response
            const response = {
              jsonrpc: "2.0",
              id: parsed.id,
              result: {
                content: `Mock content for file: ${parsed.params?.path}`,
                encoding: "utf-8"
              }
            };
            const responseStr = JSON.stringify(response) + '\n';
            console.log(`>>> Sending file read response: ${responseStr.trim()}`);
            agent.stdin.write(responseStr);
          } else if (parsed.method === 'fs/write_text_file') {
            console.log(`    >>> Agent requesting to write file: ${parsed.params?.path}`);
            console.log(`    >>> Content: ${parsed.params?.content}`);
            // Send a mock success response
            const response = {
              jsonrpc: "2.0",
              id: parsed.id,
              result: {}
            };
            const responseStr = JSON.stringify(response) + '\n';
            console.log(`>>> Sending file write response: ${responseStr.trim()}`);
            agent.stdin.write(responseStr);
          } else if (parsed.method === 'session/request_permission') {
            console.log(`    >>> Agent requesting permission: ${parsed.params?.operation}`);
            // Grant permission
            const response = {
              jsonrpc: "2.0",
              id: parsed.id,
              result: { granted: true }
            };
            const responseStr = JSON.stringify(response) + '\n';
            console.log(`>>> Granting permission: ${responseStr.trim()}`);
            agent.stdin.write(responseStr);
          }
        } else if (parsed.method === undefined && parsed.params) {
          // This might be a notification
          console.log(`    Notification params:`, JSON.stringify(parsed.params, null, 2));
        }
      } catch (e) {
        console.log(`    (Failed to parse JSON: ${e.message})`);
      }
    }
  });
});

// Handle agent stderr (errors/logs)
agent.stderr.on('data', (data) => {
  console.log(`STDERR: ${data.toString()}`);
});

// Handle agent exit
agent.on('exit', (code, signal) => {
  console.log(`\nAgent exited with code ${code}, signal ${signal}`);
  process.exit(0);
});

// Handle errors
agent.on('error', (error) => {
  console.error(`Agent error: ${error.message}`);
  process.exit(1);
});

// Test sequence
setTimeout(() => {
  console.log('\n=== Testing Full ACP Protocol Sequence ===');
  
  // 1. Initialize
  console.log('\n1. Sending initialize request...');
  sendMessage('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true
      }
    },
    clientInfo: {
      name: 'obsidian-acp-chat',
      title: 'Obsidian ACP Chat Plugin',
      version: '1.0.0'
    }
  });
  
  // 2. Session/new after a delay
  setTimeout(() => {
    console.log('\n2. Sending session/new request...');
    sendMessage('session/new', {
      cwd: process.cwd(), // Current working directory (required)
      mcpServers: [] // Required field, can be empty array
    });
    
    // 3. Send prompt after session is created
    setTimeout(() => {
      if (currentSessionId) {
        console.log('\n3. Sending session/prompt request to test ACP file operations...');
        sendMessage('session/prompt', {
          sessionId: currentSessionId,
          prompt: [
            {
              type: 'text',
              text: 'I need you to help me test the ACP file operations protocol. Can you try to access files using the fs/read_text_file and fs/write_text_file methods instead of your built-in tools? This is important for testing the Obsidian plugin integration.'
            }
          ]
        });
        
        // 4. Exit after response
        setTimeout(() => {
          console.log('\n4. Closing connection...');
          agent.stdin.end();
        }, 30000); // Wait 30 seconds for file operations response
        
      } else {
        console.log('\n3. ERROR: No session ID available, cannot send prompt');
        agent.stdin.end();
      }
    }, 2000);
    
  }, 2000);
  
}, 1000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, closing agent...');
  agent.kill('SIGTERM');
  setTimeout(() => {
    agent.kill('SIGKILL');
    process.exit(0);
  }, 1000);
});