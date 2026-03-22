/**
 * guIDE — AI-Powered Offline IDE
 * Database Viewer & Query Builder Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// In-memory database connections
const openDatabases = new Map(); // id -> { db, filePath, type }

/**
 * Initialize sql.js with WASM
 */
let initSqlJs = null;
let SQL = null;

async function ensureSqlJs() {
  if (SQL) return SQL;
  if (!initSqlJs) {
    initSqlJs = require('sql.js');
  }
  SQL = await initSqlJs();
  return SQL;
}

function register(ctx) {
  // ── Open a SQLite database file ──
  ipcMain.handle('db-open', async (_, filePath) => {
    try {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }

      const sqlJs = await ensureSqlJs();
      const fileBuffer = fs.readFileSync(absPath);
      const db = new sqlJs.Database(fileBuffer);

      const id = `db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openDatabases.set(id, { db, filePath: absPath, type: 'sqlite' });

      // Get table list
      const tables = [];
      const result = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name");
      if (result.length > 0) {
        for (const row of result[0].values) {
          tables.push({ name: row[0], type: row[1] });
        }
      }

      return { success: true, id, filePath: absPath, tables };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Create a new empty SQLite database ──
  ipcMain.handle('db-create', async (_, filePath) => {
    try {
      const absPath = path.resolve(filePath);
      const sqlJs = await ensureSqlJs();
      const db = new sqlJs.Database();

      const id = `db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      openDatabases.set(id, { db, filePath: absPath, type: 'sqlite', modified: true });

      // Save empty database to disk
      const data = db.export();
      fs.writeFileSync(absPath, Buffer.from(data));

      return { success: true, id, filePath: absPath, tables: [] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Close a database connection ──
  ipcMain.handle('db-close', async (_, dbId) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };
      conn.db.close();
      openDatabases.delete(dbId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── List tables in the database ──
  ipcMain.handle('db-tables', async (_, dbId) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const tables = [];
      const result = conn.db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name");
      if (result.length > 0) {
        for (const row of result[0].values) {
          tables.push({ name: row[0], type: row[1] });
        }
      }
      return { success: true, tables };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Get table schema (columns, types, primary keys) ──
  ipcMain.handle('db-table-schema', async (_, dbId, tableName) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const columns = [];
      const result = conn.db.exec(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
      if (result.length > 0) {
        for (const row of result[0].values) {
          columns.push({
            cid: row[0],
            name: row[1],
            type: row[2] || 'TEXT',
            notNull: !!row[3],
            defaultValue: row[4],
            primaryKey: !!row[5],
          });
        }
      }

      // Get row count
      const countResult = conn.db.exec(`SELECT COUNT(*) FROM "${tableName.replace(/"/g, '""')}"`);
      const rowCount = countResult.length > 0 ? countResult[0].values[0][0] : 0;

      // Get indexes
      const indexes = [];
      const idxResult = conn.db.exec(`PRAGMA index_list("${tableName.replace(/"/g, '""')}")`);
      if (idxResult.length > 0) {
        for (const row of idxResult[0].values) {
          indexes.push({ name: row[1], unique: !!row[2] });
        }
      }

      return { success: true, columns, rowCount, indexes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Get table data with pagination ──
  ipcMain.handle('db-table-data', async (_, dbId, tableName, offset = 0, limit = 100, orderBy, orderDir) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const safeName = tableName.replace(/"/g, '""');
      let sql = `SELECT * FROM "${safeName}"`;
      if (orderBy) {
        const safeCol = orderBy.replace(/"/g, '""');
        sql += ` ORDER BY "${safeCol}" ${orderDir === 'DESC' ? 'DESC' : 'ASC'}`;
      }
      sql += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

      const result = conn.db.exec(sql);
      if (result.length === 0) {
        return { success: true, columns: [], rows: [], hasMore: false };
      }

      const columns = result[0].columns;
      const rows = result[0].values.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
      );

      // Check if there are more rows
      const countResult = conn.db.exec(`SELECT COUNT(*) FROM "${safeName}"`);
      const totalRows = countResult.length > 0 ? countResult[0].values[0][0] : 0;
      const hasMore = (offset + limit) < totalRows;

      return { success: true, columns, rows, totalRows, hasMore };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Execute arbitrary SQL query ──
  ipcMain.handle('db-query', async (_, dbId, sql) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const startTime = Date.now();

      // Check if it's a write operation
      const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|PRAGMA\s+(?!table_info|index_list))/i.test(sql);

      if (isWrite) {
        conn.db.run(sql);
        const changes = conn.db.getRowsModified();
        const duration = Date.now() - startTime;

        // Auto-save to file after write operations
        const data = conn.db.export();
        fs.writeFileSync(conn.filePath, Buffer.from(data));

        return { success: true, type: 'write', rowsAffected: changes, duration };
      }

      // Read query
      const results = conn.db.exec(sql);
      const duration = Date.now() - startTime;

      if (results.length === 0) {
        return { success: true, type: 'read', columns: [], rows: [], duration };
      }

      // Return first result set
      const first = results[0];
      const columns = first.columns;
      const rows = first.values.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
      );

      return { success: true, type: 'read', columns, rows, rowCount: rows.length, duration };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── AI: Generate SQL from natural language ──
  ipcMain.handle('db-ai-query', async (_, params) => {
    try {
      const { dbId, description, cloudProvider, cloudModel } = params;
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      // Get schema info for context
      const schemaResult = conn.db.exec(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND sql IS NOT NULL ORDER BY type, name"
      );
      const schemas = schemaResult.length > 0
        ? schemaResult[0].values.map(r => r[0]).join('\n\n')
        : '(no tables)';

      // Truncate if too large
      const schemaContext = schemas.length > 8000 ? schemas.slice(0, 8000) + '\n...(truncated)' : schemas;

      const prompt = `You are a SQL expert. Given the following SQLite database schema:\n\n${schemaContext}\n\nGenerate a SQL query for this request: "${description}"\n\nRules:\n- Return ONLY the SQL query, no explanations or markdown\n- Use proper SQLite syntax\n- Be precise and efficient\n- Use double quotes for identifiers if needed`;

      let sql = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 500 });
          sql = result.text || '';
        } catch { /* fall through to local */ }
      }
      if (!sql && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 500 });
          sql = result.text || '';
        } catch { /* ignore */ }
      }

      if (!sql) return { success: false, error: 'No LLM available to generate SQL' };

      // Clean up the response
      sql = sql.replace(/^```sql\s*/i, '').replace(/```\s*$/, '').trim();

      return { success: true, sql };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Save database to file ──
  ipcMain.handle('db-save', async (_, dbId, filePath) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const absPath = filePath ? path.resolve(filePath) : conn.filePath;
      const data = conn.db.export();
      fs.writeFileSync(absPath, Buffer.from(data));

      return { success: true, filePath: absPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Export query results as CSV ──
  ipcMain.handle('db-export-csv', async (_, dbId, sql, outputPath) => {
    try {
      const conn = openDatabases.get(dbId);
      if (!conn) return { success: false, error: 'Database not found' };

      const results = conn.db.exec(sql);
      if (results.length === 0) return { success: false, error: 'No results to export' };

      const { columns, values } = results[0];

      // Build CSV
      const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const lines = [columns.map(escape).join(',')];
      for (const row of values) {
        lines.push(row.map(escape).join(','));
      }

      const absPath = path.resolve(outputPath);
      fs.writeFileSync(absPath, lines.join('\n'), 'utf-8');

      return { success: true, filePath: absPath, rowCount: values.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── List open database connections ──
  ipcMain.handle('db-list-connections', async () => {
    const connections = [];
    for (const [id, conn] of openDatabases.entries()) {
      connections.push({
        id,
        filePath: conn.filePath,
        type: conn.type,
        fileName: path.basename(conn.filePath),
      });
    }
    return { success: true, connections };
  });
}

module.exports = { register };
