#!/usr/bin/env node

/**
 * Full integration test: ACP client + kiro-cli agent + file operations
 * This test starts a real kiro-cli agent and handles its file operation requests
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Simple file operations handler (same as our implementation)
class FileOperationsHandler {
  constructor(config) {
    this.config = {
      vaultPath: process.cwd(),
      allowedExtensions: ['.md', '.txt', '.json'],
      maxFileSize: 10 * 1024 * 1024,
      createDirectories: true,
      ...config
    };
  }

  async readTextFile(filePath) {
    const fullPath = path.resolve(this.config.vaultPath, filePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const ext = path.extname(filePath);
    if (!this.config.allowedExtensions.includes(ext)) {
      throw new Error(`File type not allowed: ${ext}`);
    }
    
    const stats = fs.statSync(fullPath);
    if (stats.size > this.config.maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes`);
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    return { content, encoding: 'utf8' };
  }

  async writeTextFile(filePath, content, encoding = 'utf8') {
    const fullPath = path.resolve(this.config.vaultPath, filePath);
    
    const ext = path.extname(filePath);
    if (!this.config.allowedExtensions.includes(ext)) {
      throw new Error(`File type not allowed: ${ext}`);
    }
    
    const contentSize = Buffer.byteLength(content, encoding);
    if (contentSize > this.config.maxFileSize) {
      throw new Error(`Content too large: ${contentSize} bytes`);
    }
    
    if (this.config.createDirectories) {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    fs.writeFileSync(fullPath, content, encoding);
    console.log(`[FILE-OPS] Successfully wrote ${contentSize} bytes to ${filePath}`);
  }
}

console.log('🚀 Starting full ACP integration test...');
console.log('This test will:');
console.log('1. Start a real kiro-cli agent');
console.log('2. Initialize ACP protocol');
console.log('3. Create a session');
console.log('4. Send a prompt that triggers file operations');
console.log('5. Handle file operation requests from the agent');
console.log('6. Verify the agent can read and write files through our implementation\n');

// Start the kiro-cli agent
const agent = spawn('/Users/massi/.local/bin/kiro-cli', ['acp'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let messageId = 1;
let currentSessionId = null;
const fileHandler = new FileOperationsHandler();

// Function to send JSON-RPC message
function sendMessage(method, params = {}) {
  const message = {
    jsonrpc: "2.0",
    id: messageId++,
    method: method,
    params: params
  };
  
  const messageStr = JSON.stringify(message) + '\n';
  console.log(`>>> Sending: ${method}`);
  
  agent.stdin.write(messageStr);
}

let agentResponseText = '';
let isCollectingResponse = false;

// Handle agent stdout (responses and requests)
agent.stdout.on('data', async (data) => {
  const messages = data.toString().trim().split('\n');
  
  for (const msg of messages) {
    if (!msg.trim()) continue;
    
    try {
      const parsed = JSON.parse(msg);
      
      if (parsed.error) {
        console.log(`❌ Error: ${parsed.error.message} (code: ${parsed.error.code})`);
      } else if (parsed.result) {
        console.log(`✅ Result received for ${parsed.method || 'request'}`);
        
        // Store session ID if this is a session/new response
        if (parsed.result.sessionId && !currentSessionId) {
          currentSessionId = parsed.result.sessionId;
          console.log(`📝 Session ID: ${currentSessionId}`);
        }
        
        // Check if this is the end of the session/prompt response
        if (parsed.result.stopReason === 'end_turn') {
          isCollectingResponse = false;
          console.log('\n📄 AGENT RESPONSE:');
          console.log('=' .repeat(60));
          console.log(agentResponseText);
          console.log('=' .repeat(60));
          agentResponseText = '';
        }
      } else if (parsed.method) {
        // console.log(`📨 Method call: ${parsed.method}`);
        
        // Handle file operation requests from the agent
        if (parsed.method === 'fs/read_text_file') {
          console.log(`📖 Agent requesting to read: ${parsed.params?.path}`);
          try {
            const result = await fileHandler.readTextFile(parsed.params.path);
            const response = {
              jsonrpc: "2.0",
              id: parsed.id,
              result: {
                content: result.content,
                encoding: result.encoding
              }
            };
            agent.stdin.write(JSON.stringify(response) + '\n');
            console.log(`✅ File read successful: ${parsed.params.path}`);
          } catch (error) {
            const errorResponse = {
              jsonrpc: "2.0",
              id: parsed.id,
              error: {
                code: -32001,
                message: error.message
              }
            };
            agent.stdin.write(JSON.stringify(errorResponse) + '\n');
            console.log(`❌ File read failed: ${error.message}`);
          }
        } else if (parsed.method === 'fs/write_text_file') {
          console.log(`📝 Agent requesting to write: ${parsed.params?.path}`);
          try {
            await fileHandler.writeTextFile(parsed.params.path, parsed.params.content, parsed.params.encoding);
            const response = {
              jsonrpc: "2.0",
              id: parsed.id,
              result: {}
            };
            agent.stdin.write(JSON.stringify(response) + '\n');
            console.log(`✅ File write successful: ${parsed.params.path}`);
          } catch (error) {
            const errorResponse = {
              jsonrpc: "2.0",
              id: parsed.id,
              error: {
                code: -32002,
                message: error.message
              }
            };
            agent.stdin.write(JSON.stringify(errorResponse) + '\n');
            console.log(`❌ File write failed: ${error.message}`);
          }
        } else if (parsed.method === 'session/request_permission') {
          console.log(`🔐 Agent requesting permission for: ${JSON.stringify(parsed)}`);
          if (parsed.params?.toolCall?.title) {
            console.log(`   Tool: ${parsed.params.toolCall.title}`);
          }
          // Always grant permission for testing
          const response = {
            "jsonrpc": "2.0",
            "id": parsed.id,
            "result": {
              "outcome": {
                "outcome": "selected",
                "optionId": "allow_once"
              }
            }
          }
          agent.stdin.write(JSON.stringify(response) + '\n');
          console.log(`✅ Permission granted`);
        } else if (parsed.method === 'session/update') {
          // Handle streaming updates
          if (parsed.params?.update?.sessionUpdate === 'agent_message_chunk') {
            const chunk = parsed.params.update.content;
            if (chunk && chunk.type === 'text' && chunk.text) {
              if (!isCollectingResponse) {
                isCollectingResponse = true;
                console.log('\n💬 Agent is responding...');
              }
              agentResponseText += chunk.text;
             
              process.stdout.write(chunk.text);
            }
          } else if (parsed.params?.update?.sessionUpdate === 'tool_call') {
            const toolCall = parsed.params.update;
            console.log(`\n🔧 Agent using tool: ${toolCall.title || toolCall.kind || 'unknown'}`);
            if (toolCall.status) {
              console.log(`   Status: ${toolCall.status}`);
            }
            if (toolCall.locations && toolCall.locations.length > 0) {
              console.log(`   Files: ${toolCall.locations.map(l => l.path).join(', ')}`);
            }
          } else if (parsed.params?.update?.sessionUpdate === 'tool_call_update') {
            const toolCall = parsed.params.update;
            console.log(`🔧 Tool update: ${toolCall.title || 'unknown'} - ${toolCall.status || 'unknown'}`);
            if (toolCall.content && toolCall.content.length > 0) {
              for (const content of toolCall.content) {
                if (content.type === 'diff' && content.path) {
                  console.log(`   📝 Creating/modifying: ${content.path}`);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.log(`⚠️  Failed to parse: ${msg.substring(0, 100)}...`);
    }
  }
});

// Handle agent stderr
agent.stderr.on('data', (data) => {
  console.log(`🔍 Agent stderr: ${data.toString().trim()}`);
});

// Handle agent exit
agent.on('exit', (code, signal) => {
  console.log(`\n🏁 Agent exited with code ${code}, signal ${signal}`);
  process.exit(0);
});

// Handle errors
agent.on('error', (error) => {
  console.error(`💥 Agent error: ${error.message}`);
  process.exit(1);
});

// Test sequence
setTimeout(() => {
  console.log('🔄 Starting ACP protocol sequence...\n');
  
  // 1. Initialize
  console.log('1️⃣  Initializing ACP connection...');
  sendMessage('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true
      }
    },
    clientInfo: {
      name: 'acp-integration-test',
      title: 'ACP Integration Test Client',
      version: '1.0.0'
    }
  });
  
  // 2. Create session
  setTimeout(() => {
    console.log('2️⃣  Creating new session...');
    sendMessage('session/new', {
      cwd: process.cwd(),
      mcpServers: []
    });
    
    // 3. Send prompt that should trigger file operations
    setTimeout(() => {
      if (currentSessionId) {
        console.log('3️⃣  Sending prompt to trigger file operations...');
        sendMessage('session/prompt', {
          sessionId: currentSessionId,
          prompt: [
            {
              type: 'text',
              text: 'Please help me test file operations. First, read the package.json file to see what this project is about. Then create a new file called "integration-test-result.md" with a summary of what you found in package.json and confirm that the file operations are working correctly.'
            }
          ]
        });
        
        // 4. Wait for completion and exit
        setTimeout(() => {
          console.log('\n4️⃣  Test completed! Checking results...');
          
          // Check if the agent created the expected file
          if (fs.existsSync('integration-test-result.md')) {
            console.log('🎉 SUCCESS! The agent successfully created the test file.');
            const content = fs.readFileSync('integration-test-result.md', 'utf8');
            console.log('\n📄 File content:');
            console.log('---')
            console.log(content);
            console.log('---');
          } else {
            console.log('⚠️  The expected file was not created. Check the logs above.');
          }
          
          console.log('\n🏁 Closing connection...');
          agent.stdin.end();
        }, 20000); // Wait 20 seconds for file operations
        
      } else {
        console.log('❌ No session ID available, cannot send prompt');
        agent.stdin.end();
      }
    }, 3000);
    
  }, 3000);
  
}, 1000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, closing agent...');
  agent.kill('SIGTERM');
  setTimeout(() => {
    agent.kill('SIGKILL');
    process.exit(0);
  }, 1000);
});