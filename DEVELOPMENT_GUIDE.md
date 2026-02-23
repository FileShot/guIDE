# Development Guide

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git
- Local LLM (Ollama recommended)

### Environment Setup
```bash
# Clone repository
git clone <repository-url>
cd ide-app

# Install dependencies
npm install

# Install Electron
npm install --save-dev electron

# Install UI dependencies
npm install react react-dom typescript
npm install --save-dev @types/react @types/react-dom
npm install monaco-editor
npm install tailwindcss
```

## Module Development Instructions

### Module 1: Project Loader & File Explorer

#### Step 1: Create Basic Project Structure
1. Initialize React app with TypeScript
2. Set up Electron configuration
3. Create basic layout components

#### Step 2: File System Service
Create `src/services/fileSystem.ts`:
- Implement recursive directory scanning
- Build tree data structure
- Handle file system events
- Provide file metadata

#### Step 3: File Explorer Components
Create React components:
- `FileExplorer.tsx` - Main container
- `FileTree.tsx` - Tree view logic
- `FileNode.tsx` - Individual file/directory node

#### Step 4: Integration
- Connect file system service to React components
- Implement click handlers
- Add file type icons
- Test with various folder structures

### Module 2: Code Editor

#### Step 1: Monaco Editor Setup
- Install Monaco Editor
- Configure TypeScript support
- Set up basic editor instance

#### Step 2: Tab Management
Create tab system:
- `Editor.tsx` - Main editor container
- `TabBar.tsx` - Tab navigation
- `MonacoEditor.tsx` - Monaco wrapper

#### Step 3: File Integration
- Load file content when selected
- Detect file language
- Handle file changes
- Implement tab switching

#### Step 4: Features
- Syntax highlighting
- Basic editing features
- File saving
- Multiple file support

### Module 3: Chat Panel / Model Interface

#### Step 1: Chat UI Components
- `ChatPanel.tsx` - Main chat container
- `MessageList.tsx` - Message display
- `InputArea.tsx` - User input

#### Step 2: Backend API
Create `src/services/llmInterface.ts`:
- Local LLM connection
- API endpoint handlers
- Request/response formatting
- Error handling

#### Step 3: Integration
- Connect chat UI to backend
- Implement message sending
- Handle responses
- Add typing indicators

#### Step 4: AI Features
- Code analysis requests
- File editing commands
- Context awareness
- Response formatting

### Module 4: File Management

#### Step 1: Safe Write System
Create `src/services/fileManager.ts`:
- Temporary folder management
- File comparison logic
- Change preview
- Approval workflow

#### Step 2: File Operations
- Read file content
- Write to temporary location
- Compare changes
- Apply approved changes

#### Step 3: UI Integration
- Change preview modal
- Approval buttons
- Conflict resolution
- Backup management

#### Step 4: Safety Features
- Backup creation
- Rollback functionality
- Permission checks
- Error recovery

### Module 5: Task Queue / Multi-File Processing

#### Step 1: Task Queue System
Create `src/services/taskQueue.ts`:
- Task data structure
- Queue management
- Priority handling
- Status tracking

#### Step 2: Processing Logic
- Sequential task execution
- Multi-file operations
- Progress tracking
- Error handling

#### Step 3: Backend Integration
- LLM batch processing
- File system operations
- Task scheduling
- Resource management

#### Step 4: UI Components
- Task progress display
- Queue status
- Cancel/pause functionality
- Error notifications

### Module 6: Integration

#### Step 1: Electron Main Process
Create `electron.js`:
- Window management
- Menu setup
- File dialogs
- IPC communication

#### Step 2: App Layout
Create `src/App.tsx`:
- Three-panel layout
- Responsive design
- Component integration
- State management

#### Step 3: Module Communication
- Event system
- State sharing
- Data flow
- Error propagation

#### Step 4: Final Features
- Menu integration
- Keyboard shortcuts
- Settings management
- Theme support

## Development Best Practices

### Code Organization
- Keep components focused
- Separate business logic
- Use TypeScript strictly
- Follow React patterns

### Performance
- Use React.memo appropriately
- Implement lazy loading
- Optimize re-renders
- Manage memory carefully

### Error Handling
- Implement try-catch blocks
- User-friendly error messages
- Graceful degradation
- Logging for debugging

### Testing
- Write unit tests for services
- Test component rendering
- Mock external dependencies
- Test error scenarios

## Local LLM Setup

### Ollama Installation
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull coding model
ollama pull qwen2.5-coder:7b

# Start Ollama server
ollama serve
```

### Model Configuration
```typescript
const llmConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5-coder:7b',
  parameters: {
    temperature: 0.1,
    maxTokens: 4096,
    topP: 0.9
  }
};
```

## Debugging

### Frontend Debugging
- Use React DevTools
- Browser console for errors
- Network tab for API calls
- Component state inspection

### Backend Debugging
- Console logging in services
- File system operation logs
- LLM API response inspection
- Task queue status

### Electron Debugging
- DevTools in renderer process
- Main process console
- IPC message logging
- File access debugging

## Common Issues & Solutions

### File Access Issues
- Check file permissions
- Verify path handling
- Handle symbolic links
- Manage large directories

### Performance Issues
- Optimize file scanning
- Implement virtual scrolling
- Cache file content
- Limit concurrent operations

### LLM Integration Issues
- Verify model availability
- Check API endpoints
- Handle network errors
- Manage response timeouts

### Electron Issues
- Window management
- Menu configuration
- File dialog handling
- Cross-platform compatibility

## Deployment Checklist

### Pre-build
- Update dependencies
- Run tests
- Check TypeScript compilation
- Verify all features work

### Build Process
- Create production build
- Package Electron app
- Test on target platforms
- Verify installation

### Post-build
- Test installation process
- Verify file access
- Test LLM integration
- Check performance
