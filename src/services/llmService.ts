/**
 * guIDE — AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
import type { 
  ChatMessage, 
  ChatSession, 
  LLMConfig, 
  LLMResponse, 
  ChatContext,
  FileAnalysis,
  CodeGenerationResult
} from '@/types/chat';
import { defaultLLMConfig } from '@/config/llm';
import { generateId } from '@/utils/helpers';
import { fileSystemService } from './fileSystem';

export class LLMService {
  private config: LLMConfig;
  private sessions: Map<string, ChatSession> = new Map();
  private activeSessionId: string | null = null;
  private isConnected: boolean = false;
  private modelWorker: Worker | null = null;

  constructor() {
    this.config = defaultLLMConfig;
    this.initializeModel();
  }

  private async initializeModel(): Promise<void> {
    try {
      // Initialize the GGUF model using Web Worker
      this.modelWorker = new Worker('/workers/llmWorker.js');
      
      this.modelWorker.onmessage = (event) => {
        const { type, data } = event.data;
        
        switch (type) {
          case 'model-loaded':
            this.isConnected = true;
            console.log('LLM model loaded successfully');
            break;
          case 'generation-complete':
            // Handle generation completion
            break;
          case 'error':
            console.error('LLM error:', data);
            this.isConnected = false;
            break;
        }
      };

      // Load the model
      this.modelWorker.postMessage({
        type: 'load-model',
        modelPath: this.config.modelPath
      });

    } catch (error) {
      console.error('Failed to initialize LLM:', error);
      this.isConnected = false;
    }
  }

  async sendMessage(content: string, context?: ChatContext): Promise<LLMResponse> {
    if (!this.isConnected || !this.modelWorker) {
      throw new Error('LLM model not loaded');
    }

    const startTime = Date.now();
    
    try {
      // Prepare prompt with context
      const prompt = this.buildPrompt(content, context);
      
      // Send to model
      const response = await this.generateResponse(prompt);
      
      const processingTime = Date.now() - startTime;
      
      return {
        content: response.text,
        model: this.config.model,
        usage: {
          promptTokens: response.promptTokens || 0,
          completionTokens: response.completionTokens || 0,
          totalTokens: response.totalTokens || 0
        },
        finishReason: response.finishReason || 'stop',
        processingTime,
        metadata: response.metadata
      };

    } catch (error) {
      console.error('Failed to generate response:', error);
      throw error;
    }
  }

  private buildPrompt(userMessage: string, context?: ChatContext): string {
    let prompt = this.config.systemPrompt || '';
    
    // Add context information
    if (context) {
      if (context.currentFile) {
        prompt += `\n\nCurrent file: ${context.currentFile}`;
      }
      
      if (context.selectedCode) {
        prompt += `\n\nSelected code:\n\`\`\`${context.language || 'text'}\n${context.selectedCode}\n\`\`\``;
      }
      
      if (context.projectPath) {
        prompt += `\n\nProject path: ${context.projectPath}`;
      }
      
      if (context.openFiles && context.openFiles.length > 0) {
        prompt += `\n\nOpen files: ${context.openFiles.join(', ')}`;
      }
    }
    
    prompt += `\n\nUser: ${userMessage}\n\nAssistant:`;
    
    return prompt;
  }

  private async generateResponse(prompt: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.modelWorker) {
        reject(new Error('Model worker not available'));
        return;
      }

      const messageId = generateId();
      
      const handleMessage = (event: MessageEvent) => {
        const { type, data, id } = event.data;
        
        if (id === messageId) {
          this.modelWorker!.removeEventListener('message', handleMessage);
          
          if (type === 'generation-complete') {
            resolve(data);
          } else if (type === 'error') {
            reject(new Error(data.message));
          }
        }
      };

      this.modelWorker.addEventListener('message', handleMessage);
      
      this.modelWorker.postMessage({
        type: 'generate',
        id: messageId,
        prompt,
        parameters: this.config.parameters
      });
    });
  }

  async analyzeFile(filePath: string): Promise<FileAnalysis> {
    try {
      const content = await fileSystemService.readFile(filePath);
      const language = this.getLanguageFromPath(filePath);
      
      const prompt = `Analyze this ${language} file and provide:
1. A summary of what the code does
2. List of functions/methods with their signatures
3. Imports and dependencies
4. Exports and public API
5. Potential issues or improvements
6. Code complexity assessment

File content:
\`\`\`${language}
${content}
\`\`\``;

      const response = await this.sendMessage(prompt);
      
      // Parse the response into structured data
      return this.parseAnalysisResponse(response.content, filePath, language);
      
    } catch (error) {
      console.error('Failed to analyze file:', error);
      throw error;
    }
  }

  async generateCode(request: {
    type: 'function' | 'class' | 'test' | 'documentation';
    language: string;
    context: string;
    requirements: string;
  }): Promise<CodeGenerationResult> {
    const prompt = `Generate ${request.type} in ${request.language} with these requirements:
${request.requirements}

Context:
${request.context}

Please provide:
1. The generated code
2. Explanation of how it works
3. Any assumptions made`;

    try {
      const response = await this.sendMessage(prompt);
      
      return this.parseCodeGenerationResponse(response.content, request.language);
      
    } catch (error) {
      console.error('Failed to generate code:', error);
      throw error;
    }
  }

  private parseAnalysisResponse(response: string, filePath: string, language: string): FileAnalysis {
    // Simple parsing - in production, use more sophisticated parsing
    return {
      filePath,
      language,
      summary: response.substring(0, 200) + '...',
      functions: [],
      imports: [],
      exports: [],
      issues: [],
      complexity: 5,
      linesOfCode: 0
    };
  }

  private parseCodeGenerationResponse(response: string, language: string): CodeGenerationResult {
    // Simple parsing - in production, extract code blocks and explanations
    return {
      code: response,
      explanation: 'Generated code based on requirements',
      language,
      confidence: 0.8
    };
  }

  private getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'dart': 'dart',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'sql': 'sql',
      'sh': 'shell',
      'ps1': 'powershell',
      'bat': 'batch',
      'md': 'markdown'
    };
    
    return languageMap[ext] || 'text';
  }

  // Session management
  createSession(title?: string): ChatSession {
    const session: ChatSession = {
      id: generateId(),
      title: title || `Chat ${new Date().toLocaleTimeString()}`,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      model: this.config.model
    };
    
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    
    return session;
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  deleteSession(sessionId: string): boolean {
    if (sessionId === this.activeSessionId) {
      this.activeSessionId = null;
    }
    return this.sessions.delete(sessionId);
  }

  setActiveSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.activeSessionId = sessionId;
    }
  }

  getActiveSession(): ChatSession | undefined {
    if (!this.activeSessionId) return undefined;
    return this.sessions.get(this.activeSessionId);
  }

  async addMessageToSession(
    sessionId: string, 
    role: 'user' | 'assistant' | 'system', 
    content: string,
    context?: ChatContext
  ): Promise<ChatMessage> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message: ChatMessage = {
      id: generateId(),
      role,
      content,
      timestamp: new Date(),
      relatedFile: context?.currentFile,
      metadata: {
        model: this.config.model
      }
    };

    session.messages.push(message);
    session.updatedAt = new Date();

    // If it's a user message, generate assistant response
    if (role === 'user') {
      try {
        const response = await this.sendMessage(content, context);
        
        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: response.content,
          timestamp: new Date(),
          metadata: {
            model: response.model,
            tokens: response.usage.totalTokens,
            processingTime: response.processingTime,
            temperature: this.config.parameters.temperature,
            maxTokens: this.config.parameters.maxTokens
          }
        };

        session.messages.push(assistantMessage);
        session.updatedAt = new Date();
        
        return assistantMessage;
        
      } catch (error) {
        console.error('Failed to generate assistant response:', error);
        
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: 'Sorry, I encountered an error while processing your request.',
          timestamp: new Date(),
          type: 'error'
        };
        
        session.messages.push(errorMessage);
        session.updatedAt = new Date();
        
        return errorMessage;
      }
    }

    return message;
  }

  updateConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
    
    // If model path changed, reload model
    if (config.modelPath && config.modelPath !== this.config.modelPath) {
      this.initializeModel();
    }
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  isModelConnected(): boolean {
    return this.isConnected;
  }

  dispose(): void {
    if (this.modelWorker) {
      this.modelWorker.terminate();
      this.modelWorker = null;
    }
    this.isConnected = false;
    this.sessions.clear();
    this.activeSessionId = null;
  }
}

// Singleton instance
export const llmService = new LLMService();
