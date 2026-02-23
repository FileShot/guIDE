// Simple browser-compatible EventEmitter
class SimpleEventEmitter {
  private _listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  
  on(event: string, callback: (...args: any[]) => void): void {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(callback);
  }
  
  emit(event: string, ...args: any[]): void {
    const listeners = this._listeners.get(event);
    if (listeners) listeners.forEach(cb => cb(...args));
  }
  
  removeAllListeners(event?: string): void {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }
}
import type {
  Task,
  TaskQueue,
  TaskType,
  TaskPriority,
  TaskInput,
  TaskOutput,
  TaskEvent,
  TaskFilter,
  TaskSort,
  TaskSearchResult,
  BatchTaskRequest,
  BatchTaskResult,
  Worker,
  WorkerType,
  TaskScheduler,
  QueueConfig,
  TaskExecution
} from '@/types/taskQueue';
import { generateId } from '@/utils/helpers';
import { fileSystemService } from './fileSystem';
import { fileManagementService } from './fileManagementService';
import { llmService } from './llmService';

export class TaskQueueService extends SimpleEventEmitter {
  private queues: Map<string, TaskQueue> = new Map();
  private tasks: Map<string, Task> = new Map();
  private workers: Map<string, Worker> = new Map();
  private schedulers: Map<string, TaskScheduler> = new Map();
  private executions: Map<string, TaskExecution> = new Map();
  private defaultQueueId: string = 'default';
  private isRunning: boolean = false;

  constructor() {
    super();
    this.initializeDefaultQueue();
    this.initializeWorkers();
    this.initializeScheduler();
    this.startProcessing();
  }

  private initializeDefaultQueue(): void {
    const defaultQueue: TaskQueue = {
      id: this.defaultQueueId,
      name: 'Default Queue',
      description: 'Default task queue for general operations',
      tasks: [],
      status: 'active',
      config: this.getDefaultQueueConfig(),
      statistics: this.getDefaultStatistics(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.queues.set(this.defaultQueueId, defaultQueue);
  }

  private getDefaultQueueConfig(): QueueConfig {
    return {
      maxConcurrentTasks: 3,
      maxQueueSize: 100,
      retryPolicy: {
        maxRetries: 3,
        retryDelay: 5,
        exponentialBackoff: true,
        retryableErrors: ['TIMEOUT', 'NETWORK_ERROR', 'RESOURCE_ERROR']
      },
      priorityPolicy: {
        preemption: true,
        aging: true,
        starvationPrevention: true
      },
      resourceLimits: {
        maxCpuUsage: 80,
        maxMemoryUsage: 1024,
        maxDiskUsage: 512,
        maxNetworkUsage: 100
      },
      schedulingPolicy: 'priority'
    };
  }

  private getDefaultStatistics() {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      queuedTasks: 0,
      averageExecutionTime: 0,
      throughput: 0,
      successRate: 100,
      resourceUtilization: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      }
    };
  }

  private initializeWorkers(): void {
    // Create local workers for different task types
    const workerTypes: WorkerType[] = ['local', 'web_worker'];
    
    workerTypes.forEach(type => {
      const worker: Worker = {
        id: generateId(),
        name: `${type} Worker`,
        type,
        status: 'idle',
        capabilities: [
          { taskType: 'file_analysis', maxConcurrency: 2 },
          { taskType: 'code_generation', maxConcurrency: 1 },
          { taskType: 'refactoring', maxConcurrency: 1 },
          { taskType: 'testing', maxConcurrency: 2 },
          { taskType: 'documentation', maxConcurrency: 2 },
          { taskType: 'linting', maxConcurrency: 3 },
          { taskType: 'formatting', maxConcurrency: 3 },
          { taskType: 'search_replace', maxConcurrency: 2 }
        ],
        resources: {
          cpu: 4,
          memory: 2048,
          disk: 1024,
          network: true
        },
        statistics: {
          tasksCompleted: 0,
          tasksFailed: 0,
          totalExecutionTime: 0,
          averageExecutionTime: 0,
          uptime: 0
        },
        lastHeartbeat: new Date()
      };

      this.workers.set(worker.id, worker);
    });
  }

  private initializeScheduler(): void {
    const scheduler: TaskScheduler = {
      id: generateId(),
      name: 'Default Scheduler',
      type: 'priority',
      config: {
        schedulingInterval: 1000,
        loadBalancing: true,
        affinityRules: [],
        throttlingRules: []
      },
      queues: [this.defaultQueueId],
      workers: Array.from(this.workers.keys()),
      status: 'active',
      statistics: {
        tasksScheduled: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        averageWaitTime: 0,
        queueLength: 0,
        workerUtilization: 0
      }
    };

    this.schedulers.set(scheduler.id, scheduler);
  }

  private startProcessing(): void {
    this.isRunning = true;
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    const scheduler = Array.from(this.schedulers.values())[0];
    if (!scheduler || scheduler.status !== 'active') {
      setTimeout(() => this.processQueue(), 1000);
      return;
    }

    // Get available workers
    const availableWorkers = Array.from(this.workers.values())
      .filter(worker => worker.status === 'idle');

    if (availableWorkers.length === 0) {
      setTimeout(() => this.processQueue(), 1000);
      return;
    }

    // Get pending tasks
    const queue = this.queues.get(this.defaultQueueId);
    if (!queue || queue.status !== 'active') {
      setTimeout(() => this.processQueue(), 1000);
      return;
    }

    const pendingTasks = queue.tasks
      .filter(task => task.status === 'queued')
      .sort((a, b) => this.compareTaskPriority(a, b));

    // Assign tasks to workers
    for (const worker of availableWorkers) {
      const task = pendingTasks.find(task => 
        worker.capabilities.some(cap => cap.taskType === task.type)
      );

      if (task) {
        await this.executeTask(task, worker);
      }
    }

    setTimeout(() => this.processQueue(), scheduler.config.schedulingInterval);
  }

  private compareTaskPriority(a: Task, b: Task): number {
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
    const aPriority = priorityOrder[a.priority];
    const bPriority = priorityOrder[b.priority];

    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }

    // If same priority, sort by creation time (older first)
    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  private async executeTask(task: Task, worker: Worker): Promise<void> {
    // Update task and worker status
    task.status = 'running';
    task.startedAt = new Date();
    worker.status = 'busy';
    worker.currentTask = task.id;

    // Create execution record
    const execution: TaskExecution = {
      taskId: task.id,
      queueId: this.defaultQueueId,
      workerId: worker.id,
      startTime: new Date(),
      status: 'running',
      progress: { current: 0, total: 100, percentage: 0 },
      logs: [],
      metrics: {
        executionTime: 0,
        waitTime: Date.now() - task.createdAt.getTime(),
        cpuTime: 0,
        memoryPeak: 0,
        diskRead: 0,
        diskWrite: 0,
        networkIn: 0,
        networkOut: 0
      }
    };

    this.executions.set(task.id, execution);

    // Emit task started event
    this.emitEvent({
      id: generateId(),
      type: 'task_started',
      taskId: task.id,
      queueId: this.defaultQueueId,
      workerId: worker.id,
      timestamp: new Date()
    });

    try {
      // Execute the task based on its type
      const result = await this.performTask(task, execution);
      
      // Update task with results
      task.status = 'completed';
      task.completedAt = new Date();
      task.output = result;
      task.progress = { current: 100, total: 100, percentage: 100 };

      // Update execution
      execution.status = 'completed';
      execution.endTime = new Date();
      execution.metrics.executionTime = (execution.endTime.getTime() - execution.startTime.getTime()) / 1000;

      // Update statistics
      this.updateTaskStatistics(task, true);
      this.updateWorkerStatistics(worker, true, execution.metrics.executionTime);

      // Emit completion event
      this.emitEvent({
        id: generateId(),
        type: 'task_completed',
        taskId: task.id,
        queueId: this.defaultQueueId,
        workerId: worker.id,
        timestamp: new Date(),
        data: { result }
      });

    } catch (error) {
      // Handle task failure
      task.status = 'failed';
      task.error = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      };

      execution.status = 'failed';
      execution.endTime = new Date();
      execution.metrics.executionTime = (execution.endTime.getTime() - execution.startTime.getTime()) / 1000;

      this.updateTaskStatistics(task, false);
      this.updateWorkerStatistics(worker, false, execution.metrics.executionTime);

      this.emitEvent({
        id: generateId(),
        type: 'task_failed',
        taskId: task.id,
        queueId: this.defaultQueueId,
        workerId: worker.id,
        timestamp: new Date(),
        data: { error: task.error }
      });

      // Check if task should be retried
      if (this.shouldRetryTask(task)) {
        await this.retryTask(task);
      }
    } finally {
      // Reset worker status
      worker.status = 'idle';
      worker.currentTask = undefined;
    }
  }

  private async performTask(task: Task, execution: TaskExecution): Promise<TaskOutput> {
    switch (task.type) {
      case 'file_analysis':
        return await this.performFileAnalysis(task, execution);
      
      case 'code_generation':
        return await this.performCodeGeneration(task, execution);
      
      case 'refactoring':
        return await this.performRefactoring(task, execution);
      
      case 'testing':
        return await this.performTesting(task, execution);
      
      case 'documentation':
        return await this.performDocumentation(task, execution);
      
      case 'linting':
        return await this.performLinting(task, execution);
      
      case 'formatting':
        return await this.performFormatting(task, execution);
      
      case 'search_replace':
        return await this.performSearchReplace(task, execution);
      
      case 'batch_processing':
        return await this.performBatchProcessing(task, execution);
      
      default:
        throw new Error(`Unsupported task type: ${task.type}`);
    }
  }

  private async performFileAnalysis(task: Task, execution: TaskExecution): Promise<TaskOutput> {
    if (!task.input?.files || task.input.files.length === 0) {
      throw new Error('No files provided for analysis');
    }

    const results = [];
    const totalFiles = task.input.files.length;

    for (let i = 0; i < task.input.files.length; i++) {
      const filePath = task.input.files[i];
      
      // Update progress
      task.progress = {
        current: i + 1,
        total: totalFiles,
        percentage: Math.round(((i + 1) / totalFiles) * 100),
        message: `Analyzing ${filePath}`
      };

      // Add log
      execution.logs.push({
        timestamp: new Date(),
        level: 'info',
        message: `Analyzing file: ${filePath}`
      });

      try {
        const analysis = await llmService.analyzeFile(filePath);
        results.push({
          type: 'success' as const,
          message: `Analysis completed for ${filePath}`,
          details: analysis,
          file: filePath
        });
      } catch (error) {
        results.push({
          type: 'error' as const,
          message: `Failed to analyze ${filePath}`,
          details: error,
          file: filePath
        });
      }
    }

    return {
      results,
      summary: `Analyzed ${totalFiles} files`
    };
  }

  private async performCodeGeneration(task: Task, execution: TaskExecution): Promise<TaskOutput> {
    if (!task.input?.content && !task.input?.parameters?.prompt) {
      throw new Error('No content or prompt provided for code generation');
    }

    const prompt = task.input.parameters?.prompt || task.input.content || '';
    const language = task.input.parameters?.language || 'javascript';
    const context = task.input.context;

    // Update progress
    task.progress = {
      current: 50,
      total: 100,
      percentage: 50,
      message: 'Generating code...'
    };

    execution.logs.push({
      timestamp: new Date(),
      level: 'info',
      message: `Generating ${language} code`
    });

    try {
      const result = await llmService.generateCode({
        type: 'function',
        language,
        context: context?.selectedFiles?.join('\n') || '',
        requirements: prompt
      });

      task.progress = {
        current: 100,
        total: 100,
        percentage: 100,
        message: 'Code generation completed'
      };

      return {
        content: result.code,
        results: [{
          type: 'success',
          message: 'Code generated successfully',
          details: result
        }],
        summary: `Generated ${language} code`
      };
    } catch (error) {
      throw new Error(`Code generation failed: ${error}`);
    }
  }

  private async performRefactoring(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the AI Chat to request refactoring — it can read, edit, and restructure files directly.'
      }],
      summary: 'Refactoring available via AI Chat'
    };
  }

  private async performTesting(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the AI Chat or Terminal to run tests — the AI can generate and execute test suites for your project.'
      }],
      summary: 'Testing available via AI Chat & Terminal'
    };
  }

  private async performDocumentation(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the AI Chat to generate documentation — it can read your code and create docs, READMEs, and comments.'
      }],
      summary: 'Documentation available via AI Chat'
    };
  }

  private async performLinting(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the Terminal to run your project linter (e.g. eslint, pylint), or ask the AI Chat to analyze your code for issues.'
      }],
      summary: 'Linting available via Terminal & AI Chat'
    };
  }

  private async performFormatting(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the Terminal to run your formatter (e.g. prettier, black), or ask the AI Chat to format your code.'
      }],
      summary: 'Formatting available via Terminal & AI Chat'
    };
  }

  private async performSearchReplace(task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    if (!task.input?.parameters?.search) {
      throw new Error('Search pattern not provided');
    }

    const searchPattern = task.input.parameters.search;
    const replacePattern = task.input.parameters.replace;
    const files = task.input.files || [];

    const results: TaskOutput['results'] = [];
    const totalFiles = files.length;

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      
      task.progress = {
        current: i + 1,
        total: totalFiles,
        percentage: Math.round(((i + 1) / totalFiles) * 100),
        message: `Processing ${filePath}`
      };

      try {
        const content = await fileSystemService.readFile(filePath);
        const newContent = content.replace(new RegExp(searchPattern, 'g'), replacePattern || '');
        
        if (content !== newContent) {
          await fileManagementService.updateFile(filePath, newContent);
          results.push({
            type: 'success',
            message: `Replaced in ${filePath}`,
            file: filePath
          });
        }
      } catch (error) {
        results.push({
          type: 'error',
          message: `Failed to process ${filePath}`,
          details: error,
          file: filePath
        });
      }
    }

    return {
      results,
      summary: `Processed ${totalFiles} files`
    };
  }

  private async performBatchProcessing(_task: Task, _execution: TaskExecution): Promise<TaskOutput> {
    return {
      results: [{
        type: 'info',
        message: 'Use the AI Chat for batch operations — it can process multiple files in sequence using its agentic loop.'
      }],
      summary: 'Batch processing available via AI Chat'
    };
  }

  private shouldRetryTask(task: Task): boolean {
    if (!task.metadata?.retryCount) return false;
    
    const maxRetries = task.metadata.maxRetries || 3;
    return task.metadata.retryCount < maxRetries;
  }

  private async retryTask(task: Task): Promise<void> {
    if (!task.metadata) task.metadata = {};
    task.metadata.retryCount = (task.metadata.retryCount || 0) + 1;
    
    // Reset task status
    task.status = 'queued';
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.error = undefined;
    task.progress = { current: 0, total: 100, percentage: 0 };

    // Add delay for retry
    const delay = Math.pow(2, task.metadata.retryCount) * 1000; // Exponential backoff
    setTimeout(() => {
      this.addTaskToQueue(task);
    }, delay);
  }

  private updateTaskStatistics(_task: Task, success: boolean): void {
    const queue = this.queues.get(this.defaultQueueId);
    if (!queue) return;

    queue.statistics.totalTasks++;
    
    if (success) {
      queue.statistics.completedTasks++;
    } else {
      queue.statistics.failedTasks++;
    }

    // Update success rate
    queue.statistics.successRate = 
      (queue.statistics.completedTasks / queue.statistics.totalTasks) * 100;

    queue.updatedAt = new Date();
  }

  private updateWorkerStatistics(worker: Worker, success: boolean, executionTime: number): void {
    worker.statistics.tasksCompleted++;
    if (!success) {
      worker.statistics.tasksFailed++;
    }
    
    worker.statistics.totalExecutionTime += executionTime;
    worker.statistics.averageExecutionTime = 
      worker.statistics.totalExecutionTime / worker.statistics.tasksCompleted;
  }

  private emitEvent(event: TaskEvent): void {
    this.emit('taskEvent', event);
  }

  // Public API methods
  async createTask(
    type: TaskType,
    title: string,
    input?: TaskInput,
    priority: TaskPriority = 'medium',
    description?: string
  ): Promise<Task> {
    const task: Task = {
      id: generateId(),
      type,
      status: 'pending',
      priority,
      title,
      description,
      input,
      progress: { current: 0, total: 100, percentage: 0 },
      createdAt: new Date(),
      metadata: {
        retryCount: 0,
        maxRetries: 3
      }
    };

    this.tasks.set(task.id, task);
    await this.addTaskToQueue(task);

    this.emitEvent({
      id: generateId(),
      type: 'task_created',
      taskId: task.id,
      timestamp: new Date()
    });

    return task;
  }

  private async addTaskToQueue(task: Task): Promise<void> {
    const queue = this.queues.get(this.defaultQueueId);
    if (!queue) return;

    // Check queue size limit
    if (queue.tasks.length >= queue.config.maxQueueSize) {
      throw new Error('Queue is full');
    }

    task.status = 'queued';
    queue.tasks.push(task);
    queue.statistics.queuedTasks++;
    queue.updatedAt = new Date();

    this.emitEvent({
      id: generateId(),
      type: 'task_queued',
      taskId: task.id,
      queueId: this.defaultQueueId,
      timestamp: new Date()
    });
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running') {
      // Cannot cancel running tasks immediately
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = new Date();

    // Remove from queue
    const queue = this.queues.get(this.defaultQueueId);
    if (queue) {
      queue.tasks = queue.tasks.filter(t => t.id !== taskId);
      queue.updatedAt = new Date();
    }

    this.emitEvent({
      id: generateId(),
      type: 'task_cancelled',
      taskId,
      timestamp: new Date()
    });

    return true;
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;

    task.status = 'paused';
    
    this.emitEvent({
      id: generateId(),
      type: 'task_paused',
      taskId,
      timestamp: new Date()
    });

    return true;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'paused') return false;

    task.status = 'running';
    
    this.emitEvent({
      id: generateId(),
      type: 'task_resumed',
      taskId,
      timestamp: new Date()
    });

    return true;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getTasks(filter?: TaskFilter, sort?: TaskSort): TaskSearchResult {
    let tasks = Array.from(this.tasks.values());

    // Apply filters
    if (filter) {
      if (filter.status) {
        tasks = tasks.filter(task => filter.status!.includes(task.status));
      }
      if (filter.type) {
        tasks = tasks.filter(task => filter.type!.includes(task.type));
      }
      if (filter.priority) {
        tasks = tasks.filter(task => filter.priority!.includes(task.priority));
      }
      if (filter.tags) {
        tasks = tasks.filter(task => 
          task.tags && filter.tags!.some(tag => task.tags!.includes(tag))
        );
      }
      if (filter.dateRange) {
        tasks = tasks.filter(task => 
          task.createdAt >= filter.dateRange!.start && 
          task.createdAt <= filter.dateRange!.end
        );
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        tasks = tasks.filter(task => 
          task.title.toLowerCase().includes(searchLower) ||
          (task.description && task.description.toLowerCase().includes(searchLower))
        );
      }
    }

    // Apply sorting
    if (sort) {
      tasks.sort((a, b) => {
        let aValue: any = (a as any)[sort.field];
        let bValue: any = (b as any)[sort.field];

        if (aValue instanceof Date) aValue = aValue.getTime();
        if (bValue instanceof Date) bValue = bValue.getTime();

        if (sort.direction === 'desc') {
          return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
        } else {
          return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        }
      });
    }

    return {
      tasks,
      totalCount: tasks.length,
      hasMore: false
    };
  }

  getQueue(queueId: string = this.defaultQueueId): TaskQueue | undefined {
    return this.queues.get(queueId);
  }

  getWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  getTaskExecution(taskId: string): TaskExecution | undefined {
    return this.executions.get(taskId);
  }

  async createBatchTask(request: BatchTaskRequest): Promise<BatchTaskResult> {
    const batchId = generateId();
    const tasks: Task[] = [];

    for (const input of request.inputs) {
      const task = await this.createTask(
        'batch_processing',
        `Batch Task ${tasks.length + 1}`,
        input,
        request.config?.priority || 'medium'
      );
      tasks.push(task);
    }

    return {
      batchId,
      tasks,
      summary: {
        total: tasks.length,
        completed: 0,
        failed: 0,
        cancelled: 0,
        duration: 0,
        successRate: 0
      }
    };
  }

  onTaskEvent(callback: (event: TaskEvent) => void): void {
    this.on('taskEvent', callback);
  }

  dispose(): void {
    this.isRunning = false;
    this.removeAllListeners();
  }
}

// Singleton instance
export const taskQueueService = new TaskQueueService();
