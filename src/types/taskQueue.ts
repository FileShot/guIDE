export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  description?: string;
  input?: TaskInput;
  output?: TaskOutput;
  progress: TaskProgress;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: TaskError;
  metadata?: TaskMetadata;
  dependencies?: string[]; // Task IDs that must complete first
  tags?: string[];
}

export type TaskType = 
  | 'file_analysis'
  | 'code_generation'
  | 'refactoring'
  | 'testing'
  | 'documentation'
  | 'linting'
  | 'formatting'
  | 'build'
  | 'deploy'
  | 'search_replace'
  | 'batch_processing'
  | 'custom';

export type TaskStatus = 
  | 'pending'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskInput {
  files?: string[];
  content?: string;
  parameters?: Record<string, any>;
  context?: TaskContext;
}

export interface TaskOutput {
  files?: TaskFile[];
  content?: string;
  results?: TaskResult[];
  summary?: string;
  artifacts?: TaskArtifact[];
}

export interface TaskFile {
  path: string;
  content: string;
  operation: 'create' | 'update' | 'delete';
  encoding?: string;
}

export interface TaskResult {
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
  details?: any;
  file?: string;
  line?: number;
  column?: number;
}

export interface TaskArtifact {
  name: string;
  type: 'file' | 'directory' | 'data';
  path?: string;
  content?: any;
  size?: number;
}

export interface TaskProgress {
  current: number;
  total: number;
  percentage: number;
  message?: string;
  eta?: number; // Estimated time remaining in seconds
}

export interface TaskError {
  code: string;
  message: string;
  stack?: string;
  details?: any;
}

export interface TaskMetadata {
  author?: string;
  category?: string;
  estimatedDuration?: number; // in seconds
  actualDuration?: number; // in seconds
  retryCount?: number;
  maxRetries?: number;
  timeout?: number; // in seconds
  resourceUsage?: ResourceUsage;
}

export interface ResourceUsage {
  cpu?: number; // percentage
  memory?: number; // in MB
  disk?: number; // in MB
  network?: number; // in MB
}

export interface TaskContext {
  projectPath?: string;
  selectedFiles?: string[];
  activeEditor?: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
  gitBranch?: string;
  buildConfiguration?: string;
}

export interface TaskQueue {
  id: string;
  name: string;
  description?: string;
  tasks: Task[];
  status: QueueStatus;
  config: QueueConfig;
  statistics: QueueStatistics;
  createdAt: Date;
  updatedAt: Date;
}

export type QueueStatus = 'active' | 'paused' | 'stopped' | 'error';

export interface QueueConfig {
  maxConcurrentTasks: number;
  maxQueueSize: number;
  retryPolicy: RetryPolicy;
  priorityPolicy: PriorityPolicy;
  resourceLimits: ResourceLimits;
  schedulingPolicy: SchedulingPolicy;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelay: number; // in seconds
  exponentialBackoff: boolean;
  retryableErrors: string[];
}

export interface PriorityPolicy {
  preemption: boolean; // Higher priority tasks can preempt lower ones
  aging: boolean; // Lower priority tasks gain priority over time
  starvationPrevention: boolean;
}

export interface ResourceLimits {
  maxCpuUsage: number; // percentage
  maxMemoryUsage: number; // in MB
  maxDiskUsage: number; // in MB
  maxNetworkUsage: number; // in MB
}

export type SchedulingPolicy = 
  | 'fifo' // First In, First Out
  | 'priority' // Priority-based
  | 'fair' // Fair share
  | 'shortest_job_first' // SJF
  | 'round_robin'; // Round Robin

export interface QueueStatistics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  queuedTasks: number;
  averageExecutionTime: number; // in seconds
  throughput: number; // tasks per minute
  successRate: number; // percentage
  resourceUtilization: ResourceUsage;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  defaultPriority: TaskPriority;
  inputSchema: TaskInputSchema;
  outputSchema: TaskOutputSchema;
  estimatedDuration: number;
  resourceRequirements: ResourceRequirements;
  tags: string[];
}

export interface TaskInputSchema {
  properties: Record<string, TaskProperty>;
  required?: string[];
}

export interface TaskOutputSchema {
  properties: Record<string, TaskProperty>;
}

export interface TaskProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'file';
  description?: string;
  default?: any;
  enum?: any[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface ResourceRequirements {
  minCpu: number; // percentage
  minMemory: number; // in MB
  minDisk: number; // in MB
  minNetwork: number; // in MB
}

export interface TaskExecution {
  taskId: string;
  queueId: string;
  workerId?: string;
  startTime: Date;
  endTime?: Date;
  status: TaskStatus;
  progress: TaskProgress;
  logs: TaskLog[];
  metrics: TaskMetrics;
}

export interface TaskLog {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

export interface TaskMetrics {
  executionTime: number; // in seconds
  waitTime: number; // in seconds
  cpuTime: number; // in seconds
  memoryPeak: number; // in MB
  diskRead: number; // in MB
  diskWrite: number; // in MB
  networkIn: number; // in MB
  networkOut: number; // in MB
}

export interface Worker {
  id: string;
  name: string;
  type: WorkerType;
  status: WorkerStatus;
  currentTask?: string;
  capabilities: WorkerCapability[];
  resources: WorkerResources;
  statistics: WorkerStatistics;
  lastHeartbeat: Date;
}

export type WorkerType = 'local' | 'remote' | 'web_worker' | 'child_process';

export type WorkerStatus = 'idle' | 'busy' | 'offline' | 'error';

export interface WorkerCapability {
  taskType: TaskType;
  maxConcurrency: number;
  supportedFeatures?: string[];
}

export interface WorkerResources {
  cpu: number; // available cores
  memory: number; // available MB
  disk: number; // available MB
  network: boolean;
}

export interface WorkerStatistics {
  tasksCompleted: number;
  tasksFailed: number;
  totalExecutionTime: number; // in seconds
  averageExecutionTime: number; // in seconds
  uptime: number; // in seconds
}

export interface TaskScheduler {
  id: string;
  name: string;
  type: SchedulerType;
  config: SchedulerConfig;
  queues: string[]; // Queue IDs
  workers: string[]; // Worker IDs
  status: SchedulerStatus;
  statistics: SchedulerStatistics;
}

export type SchedulerType = 'simple' | 'priority' | 'resource_aware' | 'deadline_aware';

export interface SchedulerConfig {
  schedulingInterval: number; // in milliseconds
  loadBalancing: boolean;
  affinityRules: AffinityRule[];
  throttlingRules: ThrottlingRule[];
}

export interface AffinityRule {
  taskType: TaskType;
  workerType: WorkerType;
  priority: number;
}

export interface ThrottlingRule {
  taskType: TaskType;
  maxConcurrent: number;
  timeWindow: number; // in seconds
}

export interface SchedulerStatistics {
  tasksScheduled: number;
  tasksCompleted: number;
  tasksFailed: number;
  averageWaitTime: number; // in seconds
  queueLength: number;
  workerUtilization: number; // percentage
}

export type SchedulerStatus = 'active' | 'paused' | 'stopped' | 'error';

export interface TaskEvent {
  id: string;
  type: TaskEventType;
  taskId: string;
  queueId?: string;
  workerId?: string;
  timestamp: Date;
  data?: any;
}

export type TaskEventType = 
  | 'task_created'
  | 'task_queued'
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'task_paused'
  | 'task_resumed'
  | 'worker_assigned'
  | 'worker_unassigned'
  | 'queue_created'
  | 'queue_deleted'
  | 'worker_connected'
  | 'worker_disconnected';

export interface TaskFilter {
  status?: TaskStatus[];
  type?: TaskType[];
  priority?: TaskPriority[];
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  search?: string;
}

export interface TaskSort {
  field: TaskSortField;
  direction: 'asc' | 'desc';
}

export type TaskSortField = 
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
  | 'priority'
  | 'title'
  | 'progress'
  | 'estimatedDuration'
  | 'actualDuration';

export interface TaskSearchResult {
  tasks: Task[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface BatchTaskRequest {
  templateId: string;
  inputs: TaskInput[];
  config?: BatchTaskConfig;
}

export interface BatchTaskConfig {
  maxConcurrency?: number;
  failFast?: boolean;
  continueOnError?: boolean;
  priority?: TaskPriority;
  dependencies?: TaskDependency[];
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string;
  type: 'sequential' | 'parallel';
}

export interface BatchTaskResult {
  batchId: string;
  tasks: Task[];
  summary: BatchTaskSummary;
}

export interface BatchTaskSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  duration: number; // in seconds
  successRate: number; // percentage
}
