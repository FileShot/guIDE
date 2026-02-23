/**
 * guIDE — AI-Powered Offline IDE
 * Database Viewer & Query Builder Panel
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Database, Table, Play, Plus, X, Download, Sparkles, ChevronRight, ChevronDown,
  HardDrive, Loader, AlertTriangle, RefreshCw,
  ArrowUp, ArrowDown, FolderOpen,
} from 'lucide-react';

interface TableInfo {
  name: string;
  type: string;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: any;
  primaryKey: boolean;
}

interface QueryResult {
  type: 'read' | 'write';
  columns?: string[];
  rows?: Record<string, any>[];
  rowCount?: number;
  rowsAffected?: number;
  duration: number;
}

interface DbConnection {
  id: string;
  filePath: string;
  fileName: string;
  type: string;
}

export const DatabasePanel: React.FC = () => {
  // Connection state
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [activeDb, setActiveDb] = useState<string>('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [tableSchemas, setTableSchemas] = useState<Record<string, ColumnInfo[]>>({});
  const [tableRowCounts, setTableRowCounts] = useState<Record<string, number>>({});

  // Query state
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState('');
  const [executing, setExecuting] = useState(false);

  // Table data view
  const [viewingTable, setViewingTable] = useState('');
  const [tableData, setTableData] = useState<{ columns: string[]; rows: Record<string, any>[] }>({ columns: [], rows: [] });
  const [tableDataPage, setTableDataPage] = useState(0);
  const [tableDataTotal, setTableDataTotal] = useState(0);
  const [sortColumn, setSortColumn] = useState('');
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [loadingData, setLoadingData] = useState(false);

  // AI state
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingQuery, setGeneratingQuery] = useState(false);

  // General
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'query' | 'data'>('query');
  const queryRef = useRef<HTMLTextAreaElement>(null);

  const api = window.electronAPI;
  const PAGE_SIZE = 100;

  // Load connections on mount
  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      const result = await api.dbListConnections();
      if (result.success) setConnections(result.connections || []);
    } catch { /* ignore */ }
  }, []);

  // ── Open SQLite file ──
  const handleOpenFile = useCallback(async () => {
    try {
      const result = await api.showOpenDialog({
        title: 'Open SQLite Database',
        filters: [
          { name: 'SQLite Databases', extensions: ['sqlite', 'sqlite3', 'db', 'db3', 's3db'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (!result || result.canceled || !result.filePaths?.length) return;

      const openResult = await api.dbOpen(result.filePaths[0]);
      if (openResult.success) {
        setActiveDb(openResult.id || '');
        setTables((openResult.tables || []) as TableInfo[]);
        setError('');
        await loadConnections();
      } else {
        setError(openResult.error || 'Failed to open database');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // ── Create new database ──
  const handleCreateDb = useCallback(async () => {
    try {
      const result = await api.showSaveDialog({
        title: 'Create New SQLite Database',
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
        defaultPath: 'new_database.sqlite',
      });
      if (!result || result.canceled || !result.filePath) return;

      const createResult = await api.dbCreate(result.filePath);
      if (createResult.success) {
        setActiveDb(createResult.id || '');
        setTables([]);
        setError('');
        await loadConnections();
      } else {
        setError(createResult.error || 'Failed to create database');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // ── Switch active database ──
  const switchDatabase = useCallback(async (dbId: string) => {
    setActiveDb(dbId);
    setViewingTable('');
    setQueryResult(null);
    setQueryError('');
    try {
      const result = await api.dbTables(dbId);
      if (result.success) {
        setTables((result.tables || []) as TableInfo[]);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Close database ──
  const closeDatabase = useCallback(async (dbId: string) => {
    try {
      await api.dbClose(dbId);
      if (activeDb === dbId) {
        setActiveDb('');
        setTables([]);
        setViewingTable('');
      }
      await loadConnections();
    } catch { /* ignore */ }
  }, [activeDb]);

  // ── Load table schema ──
  const loadTableSchema = useCallback(async (tableName: string) => {
    if (!activeDb) return;
    try {
      const result = await api.dbTableSchema(activeDb, tableName);
      if (result.success) {
        setTableSchemas(prev => ({ ...prev, [tableName]: (result.columns || []) as ColumnInfo[] }));
        setTableRowCounts(prev => ({ ...prev, [tableName]: result.rowCount ?? 0 }));
      }
    } catch { /* ignore */ }
  }, [activeDb]);

  // ── Toggle table expand ──
  const toggleTable = useCallback((tableName: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
        if (!tableSchemas[tableName]) loadTableSchema(tableName);
      }
      return next;
    });
  }, [tableSchemas, loadTableSchema]);

  // ── View table data ──
  const viewTable = useCallback(async (tableName: string, page = 0, sortCol = '', sortDirection: 'ASC' | 'DESC' = 'ASC') => {
    if (!activeDb) return;
    setLoadingData(true);
    setViewingTable(tableName);
    setActiveTab('data');
    try {
      const result = await api.dbTableData(activeDb, tableName, page * PAGE_SIZE, PAGE_SIZE, sortCol || undefined, sortDirection);
      if (result.success) {
        setTableData({ columns: result.columns || [], rows: result.rows || [] });
        setTableDataTotal(result.totalRows || 0);
        setTableDataPage(page);
      }
    } catch { /* ignore */ }
    setLoadingData(false);
  }, [activeDb]);

  // ── Execute query ──
  const executeQuery = useCallback(async () => {
    if (!activeDb || !query.trim()) return;
    setExecuting(true);
    setQueryError('');
    setQueryResult(null);
    try {
      const result = await api.dbQuery(activeDb, query.trim());
      if (result.success) {
        setQueryResult(result as QueryResult);
        // Refresh tables if it was a DDL/write operation
        if (result.type === 'write') {
          const tabResult = await api.dbTables(activeDb);
          if (tabResult.success) setTables((tabResult.tables || []) as TableInfo[]);
        }
      } else {
        setQueryError(result.error || 'Query failed');
      }
    } catch (err: any) {
      setQueryError(err.message);
    }
    setExecuting(false);
  }, [activeDb, query]);

  // ── AI Generate SQL ──
  const generateSql = useCallback(async () => {
    if (!activeDb || !aiPrompt.trim()) return;
    setGeneratingQuery(true);
    try {
      const provider = localStorage.getItem('guIDE-cloud-provider') || '';
      const model = localStorage.getItem('guIDE-cloud-model') || '';
      const result = await api.dbAiQuery({
        dbId: activeDb,
        description: aiPrompt.trim(),
        cloudProvider: provider,
        cloudModel: model,
      });
      if (result.success && result.sql) {
        setQuery(result.sql);
        setAiPrompt('');
        if (queryRef.current) queryRef.current.focus();
      } else {
        setError(result.error || 'Failed to generate SQL');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setGeneratingQuery(false);
  }, [activeDb, aiPrompt]);

  // ── Export results as CSV ──
  const exportCsv = useCallback(async () => {
    if (!activeDb || !query.trim()) return;
    try {
      const saveResult = await api.showSaveDialog({
        title: 'Export Results as CSV',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        defaultPath: 'query_results.csv',
      });
      if (!saveResult || saveResult.canceled || !saveResult.filePath) return;

      const result = await api.dbExportCsv(activeDb, query.trim(), saveResult.filePath);
      if (!result.success) setError(result.error || 'Export failed');
    } catch (err: any) {
      setError(err.message);
    }
  }, [activeDb, query]);

  // ── Sort column ──
  const handleSort = useCallback((col: string) => {
    const newDir = sortColumn === col && sortDir === 'ASC' ? 'DESC' : 'ASC';
    setSortColumn(col);
    setSortDir(newDir);
    if (viewingTable) {
      viewTable(viewingTable, 0, col, newDir);
    }
  }, [sortColumn, sortDir, viewingTable, viewTable]);

  // ── Quick query helpers ──
  const setSelectAll = (tableName: string) => {
    setQuery(`SELECT * FROM "${tableName}" LIMIT 100`);
    setActiveTab('query');
  };

  // ── No database open state ──
  if (!activeDb && connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
        <Database size={48} style={{ color: 'var(--theme-foreground-muted)', opacity: 0.4 }} />
        <p className="text-[12px] text-center" style={{ color: 'var(--theme-foreground-muted)' }}>
          No database connected.<br />Open or create a SQLite database to get started.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleOpenFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
          >
            <FolderOpen size={14} /> Open Database
          </button>
          <button
            onClick={handleCreateDb}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-colors"
            style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
          >
            <Plus size={14} /> New Database
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Connection bar */}
      <div className="flex items-center gap-1 px-2 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary)' }}>
        <HardDrive size={14} style={{ color: 'var(--theme-accent)' }} />
        <select
          value={activeDb}
          onChange={e => switchDatabase(e.target.value)}
          className="flex-1 bg-transparent text-[11px] outline-none truncate cursor-pointer"
          style={{ color: 'var(--theme-foreground)' }}
        >
          {connections.map(c => (
            <option key={c.id} value={c.id}>{c.fileName}</option>
          ))}
        </select>
        <button onClick={handleOpenFile} className="p-1 hover:opacity-80" title="Open Database" style={{ color: 'var(--theme-foreground-muted)' }}>
          <FolderOpen size={14} />
        </button>
        <button onClick={handleCreateDb} className="p-1 hover:opacity-80" title="New Database" style={{ color: 'var(--theme-foreground-muted)' }}>
          <Plus size={14} />
        </button>
        {activeDb && (
          <button onClick={() => closeDatabase(activeDb)} className="p-1 hover:opacity-80" title="Close Database" style={{ color: 'var(--theme-foreground-muted)' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ backgroundColor: '#5a1d1d', color: '#f48771' }}>
          <AlertTriangle size={12} />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}

      {/* Table browser */}
      <div className="flex flex-col flex-shrink-0 overflow-auto" style={{ maxHeight: '40%', borderBottom: '1px solid var(--theme-border)' }}>
        <div className="flex items-center justify-between px-3 py-1" style={{ backgroundColor: 'var(--theme-bg-secondary)' }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-foreground-muted)' }}>
            Tables ({tables.length})
          </span>
          <button
            onClick={async () => {
              if (!activeDb) return;
              const r = await api.dbTables(activeDb);
              if (r.success) setTables((r.tables || []) as TableInfo[]);
            }}
            className="p-0.5 hover:opacity-80"
            title="Refresh"
            style={{ color: 'var(--theme-foreground-muted)' }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        {tables.map(t => (
          <div key={t.name}>
            <div
              className="flex items-center gap-1 px-3 py-1 cursor-pointer hover:opacity-80 transition-opacity"
              style={{ backgroundColor: viewingTable === t.name ? 'var(--theme-selection)' : 'transparent' }}
            >
              <button onClick={() => toggleTable(t.name)} className="flex-shrink-0">
                {expandedTables.has(t.name) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <button className="flex items-center gap-1.5 flex-1 text-left truncate" onClick={() => viewTable(t.name)}>
                <Table size={12} style={{ color: t.type === 'view' ? '#c586c0' : 'var(--theme-accent)' }} />
                <span className="truncate">{t.name}</span>
                {typeof tableRowCounts[t.name] === 'number' && (
                  <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>
                    {tableRowCounts[t.name]} rows
                  </span>
                )}
              </button>
              <button
                onClick={() => setSelectAll(t.name)}
                className="flex-shrink-0 p-0.5 hover:opacity-80"
                title="SELECT * query"
                style={{ color: 'var(--theme-foreground-muted)' }}
              >
                <Play size={10} />
              </button>
            </div>
            {/* Column details */}
            {expandedTables.has(t.name) && tableSchemas[t.name] && (
              <div className="pl-8 pb-1">
                {tableSchemas[t.name].map(col => (
                  <div key={col.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                    <span className={`${col.primaryKey ? 'font-bold' : ''}`} style={{ color: col.primaryKey ? '#dcdcaa' : 'var(--theme-foreground)' }}>
                      {col.primaryKey ? '🔑 ' : ''}{col.name}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                      {col.type}{col.notNull ? ' NOT NULL' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {tables.length === 0 && activeDb && (
          <div className="px-3 py-2 text-[11px] italic" style={{ color: 'var(--theme-foreground-muted)' }}>
            No tables. Run CREATE TABLE to add one.
          </div>
        )}
      </div>

      {/* Tab bar: Query / Data */}
      <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <button
          onClick={() => setActiveTab('query')}
          className="px-4 py-1.5 text-[11px] transition-colors"
          style={{
            borderBottom: activeTab === 'query' ? '2px solid var(--theme-accent)' : '2px solid transparent',
            color: activeTab === 'query' ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
            backgroundColor: 'transparent',
          }}
        >
          SQL Query
        </button>
        <button
          onClick={() => setActiveTab('data')}
          className="px-4 py-1.5 text-[11px] transition-colors"
          style={{
            borderBottom: activeTab === 'data' ? '2px solid var(--theme-accent)' : '2px solid transparent',
            color: activeTab === 'data' ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
            backgroundColor: 'transparent',
          }}
        >
          Data{viewingTable ? ` — ${viewingTable}` : ''}
        </button>
      </div>

      {/* Query tab */}
      {activeTab === 'query' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* AI Query Generator */}
          <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: '1px solid var(--theme-border)' }}>
            <Sparkles size={12} style={{ color: '#dcdcaa' }} />
            <input
              type="text"
              placeholder="Describe what you want in English..."
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') generateSql(); }}
              className="flex-1 bg-transparent text-[11px] outline-none"
              style={{ color: 'var(--theme-foreground)' }}
            />
            <button
              onClick={generateSql}
              disabled={generatingQuery || !aiPrompt.trim()}
              className="px-2 py-0.5 rounded text-[10px] disabled:opacity-50"
              style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
            >
              {generatingQuery ? <Loader size={10} className="animate-spin" /> : 'Generate'}
            </button>
          </div>

          {/* SQL editor */}
          <div className="relative flex-shrink-0" style={{ minHeight: 80 }}>
            <textarea
              ref={queryRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  executeQuery();
                }
              }}
              placeholder="Enter SQL query... (Ctrl+Enter to execute)"
              className="w-full h-[80px] p-2 font-mono text-[12px] resize-y outline-none"
              style={{
                backgroundColor: 'var(--theme-bg)',
                color: 'var(--theme-foreground)',
                border: 'none',
                borderBottom: '1px solid var(--theme-border)',
              }}
              spellCheck={false}
            />
          </div>

          {/* Query toolbar */}
          <div className="flex items-center gap-2 px-2 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
            <button
              onClick={executeQuery}
              disabled={executing || !query.trim()}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] disabled:opacity-50"
              style={{ backgroundColor: '#388e3c', color: '#fff' }}
            >
              {executing ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
              Run
            </button>
            {queryResult?.type === 'read' && queryResult.rows && queryResult.rows.length > 0 && (
              <button
                onClick={exportCsv}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
              >
                <Download size={12} /> Export CSV
              </button>
            )}
            <div className="flex-1" />
            {queryResult && (
              <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                {queryResult.type === 'read'
                  ? `${queryResult.rowCount} rows in ${queryResult.duration}ms`
                  : `${queryResult.rowsAffected} rows affected in ${queryResult.duration}ms`}
              </span>
            )}
          </div>

          {/* Query error */}
          {queryError && (
            <div className="px-3 py-2 text-[11px] font-mono" style={{ color: '#f48771', backgroundColor: '#5a1d1d' }}>
              {queryError}
            </div>
          )}

          {/* Query results table */}
          {queryResult?.type === 'read' && queryResult.columns && (
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    {queryResult.columns.map(col => (
                      <th key={col} className="sticky top-0 text-left px-2 py-1 font-semibold cursor-pointer hover:opacity-80"
                          style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', borderBottom: '1px solid var(--theme-border)' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.rows?.map((row, i) => (
                    <tr key={i} className="hover:opacity-90" style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--theme-bg-secondary)' }}>
                      {queryResult.columns!.map(col => (
                        <td key={col} className="px-2 py-0.5 font-mono" style={{ borderBottom: '1px solid var(--theme-border)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row[col] === null ? <span style={{ color: 'var(--theme-foreground-muted)', fontStyle: 'italic' }}>NULL</span> : String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {queryResult.rows?.length === 0 && (
                <div className="p-4 text-center text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                  No results
                </div>
              )}
            </div>
          )}

          {/* Write result */}
          {queryResult?.type === 'write' && (
            <div className="px-3 py-2 text-[11px]" style={{ color: '#4ec9b0' }}>
              ✓ {queryResult.rowsAffected} row(s) affected ({queryResult.duration}ms)
            </div>
          )}
        </div>
      )}

      {/* Data tab */}
      {activeTab === 'data' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {!viewingTable ? (
            <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
              Click a table to view its data
            </div>
          ) : (
            <>
              {/* Data toolbar */}
              <div className="flex items-center gap-2 px-2 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
                <Table size={12} style={{ color: 'var(--theme-accent)' }} />
                <span className="font-semibold">{viewingTable}</span>
                <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                  {tableDataTotal} rows
                </span>
                <div className="flex-1" />
                {loadingData && <Loader size={12} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />}
                <button
                  onClick={() => viewTable(viewingTable, 0, sortColumn, sortDir)}
                  className="p-0.5 hover:opacity-80"
                  title="Refresh"
                  style={{ color: 'var(--theme-foreground-muted)' }}
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {/* Data grid */}
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {tableData.columns.map(col => (
                        <th
                          key={col}
                          className="sticky top-0 text-left px-2 py-1 font-semibold cursor-pointer hover:opacity-80 select-none"
                          style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', borderBottom: '1px solid var(--theme-border)' }}
                          onClick={() => handleSort(col)}
                        >
                          <span className="flex items-center gap-1">
                            {col}
                            {sortColumn === col && (sortDir === 'ASC' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, i) => (
                      <tr key={i} className="hover:opacity-90" style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--theme-bg-secondary)' }}>
                        {tableData.columns.map(col => (
                          <td key={col} className="px-2 py-0.5 font-mono" style={{ borderBottom: '1px solid var(--theme-border)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row[col] === null ? <span style={{ color: 'var(--theme-foreground-muted)', fontStyle: 'italic' }}>NULL</span> : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {tableDataTotal > PAGE_SIZE && (
                <div className="flex items-center justify-between px-3 py-1 flex-shrink-0" style={{ borderTop: '1px solid var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary)' }}>
                  <button
                    disabled={tableDataPage === 0}
                    onClick={() => viewTable(viewingTable, tableDataPage - 1, sortColumn, sortDir)}
                    className="px-2 py-0.5 rounded text-[10px] disabled:opacity-30"
                    style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
                  >
                    ← Prev
                  </button>
                  <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                    Page {tableDataPage + 1} of {Math.ceil(tableDataTotal / PAGE_SIZE)} ({tableDataTotal} rows)
                  </span>
                  <button
                    disabled={(tableDataPage + 1) * PAGE_SIZE >= tableDataTotal}
                    onClick={() => viewTable(viewingTable, tableDataPage + 1, sortColumn, sortDir)}
                    className="px-2 py-0.5 rounded text-[10px] disabled:opacity-30"
                    style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
