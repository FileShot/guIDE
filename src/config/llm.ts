import type { LLMConfig, ModelInfo, QuickAction, ChatCommand, ChatContext } from '@/types/chat';

export const defaultLLMConfig: LLMConfig = {
  provider: 'local-gguf',
  modelPath: './qwen2.5-coder-7b-instruct-q4_k_m.gguf',
  model: 'qwen2.5-coder-7b-instruct-q4_k_m',
  parameters: {
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1
  },
  contextWindow: 32768,
  systemPrompt: `You are an expert AI coding assistant integrated into a desktop IDE. You specialize in:

1. Code analysis and understanding
2. Bug detection and fixing
3. Code refactoring suggestions
4. Writing clean, maintainable code
5. Explaining complex concepts simply
6. Following best practices and coding standards

When analyzing code, provide:
- Clear explanations of what the code does
- Identification of potential issues or improvements
- Suggestions for optimization
- Code examples when helpful

When writing code, ensure:
- Proper error handling
- Clear comments and documentation
- Consistent formatting and style
- Security best practices
- Performance considerations

Always be helpful, accurate, and provide actionable advice.`
};

export const supportedModels: ModelInfo[] = [
  {
    name: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M',
    path: './qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    size: 4.37 * 1024 * 1024 * 1024, // ~4.37GB
    contextWindow: 32768,
    supportedFormats: ['gguf'],
    description: 'Specialized coding model with excellent code understanding and generation capabilities'
  }
];

export const quickActions: QuickAction[] = [
  {
    id: 'analyze-code',
    label: 'Analyze Code',
    icon: '>',
    command: '/analyze',
    description: 'Analyze the current file or selected code',
    category: 'analysis'
  },
  {
    id: 'explain-code',
    label: 'Explain Code',
    icon: '*',
    command: '/explain',
    description: 'Get detailed explanation of the code',
    category: 'analysis'
  },
  {
    id: 'fix-bugs',
    label: 'Fix Bugs',
    icon: 'x',
    command: '/fix',
    description: 'Identify and fix bugs in the code',
    category: 'code'
  },
  {
    id: 'optimize',
    label: 'Optimize',
    icon: '^',
    command: '/optimize',
    description: 'Suggest performance optimizations',
    category: 'code'
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: '~',
    command: '/refactor',
    description: 'Suggest refactoring improvements',
    category: 'code'
  },
  {
    id: 'add-tests',
    label: 'Add Tests',
    icon: 'T',
    command: '/test',
    description: 'Generate unit tests for the code',
    category: 'code'
  },
  {
    id: 'add-docs',
    label: 'Add Documentation',
    icon: 'D',
    command: '/docs',
    description: 'Generate documentation and comments',
    category: 'code'
  },
  {
    id: 'security-check',
    label: 'Security Check',
    icon: '!',
    command: '/security',
    description: 'Analyze code for security issues',
    category: 'analysis'
  }
];

export const chatCommands: ChatCommand[] = [
  {
    id: 'analyze',
    name: 'analyze',
    description: 'Analyze code structure, complexity, and potential issues',
    category: 'analysis',
    handler: async (_params: any, _context: ChatContext) => {
      // Implementation will be in the LLM service
      return 'Analyzing code...';
    }
  },
  {
    id: 'explain',
    name: 'explain',
    description: 'Provide detailed explanation of code functionality',
    category: 'analysis',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Explaining code...';
    }
  },
  {
    id: 'fix',
    name: 'fix',
    description: 'Identify and fix bugs in the code',
    category: 'editing',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Fixing issues...';
    }
  },
  {
    id: 'optimize',
    name: 'optimize',
    description: 'Suggest performance optimizations',
    category: 'editing',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Optimizing code...';
    }
  },
  {
    id: 'refactor',
    name: 'refactor',
    description: 'Suggest refactoring improvements',
    category: 'editing',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Refactoring suggestions...';
    }
  },
  {
    id: 'test',
    name: 'test',
    description: 'Generate unit tests for the code',
    category: 'generation',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Generating tests...';
    }
  },
  {
    id: 'docs',
    name: 'docs',
    description: 'Generate documentation and comments',
    category: 'generation',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Generating documentation...';
    }
  },
  {
    id: 'security',
    name: 'security',
    description: 'Analyze code for security vulnerabilities',
    category: 'analysis',
    handler: async (_params: any, _context: ChatContext) => {
      return 'Security analysis...';
    }
  }
];

export function getModelConfig(modelPath: string): LLMConfig {
  const model = supportedModels.find(m => m.path === modelPath);
  if (!model) {
    return defaultLLMConfig;
  }

  return {
    ...defaultLLMConfig,
    modelPath: model.path,
    model: model.name,
    contextWindow: model.contextWindow
  };
}

export function getQuickAction(command: string): QuickAction | undefined {
  return quickActions.find(action => action.command === command);
}

export function getChatCommand(command: string): ChatCommand | undefined {
  return chatCommands.find(cmd => cmd.name === command);
}
