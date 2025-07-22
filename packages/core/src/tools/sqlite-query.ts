/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { Config } from '../config/config.js';

/**
 * Parameters for the SQLiteQuery tool
 */
export interface SQLiteQueryToolParams {
  /**
   * SQL query to execute
   */
  query: string;
  
  /**
   * Database file path (optional, defaults to wafer.db in target directory)
   */
  database?: string;
  
  /**
   * Maximum number of rows to return (default: 100)
   */
  limit?: number;
}

/**
 * Result row interface
 */
interface QueryRow {
  [key: string]: any;
}

/**
 * Implementation of the SQLiteQuery tool logic
 */
export class SQLiteQueryTool extends BaseTool<
  SQLiteQueryToolParams,
  ToolResult
> {
  static readonly Name: string = 'sqlite_query';

  constructor(private config: Config) {
    super(
      SQLiteQueryTool.Name,
      'SQLite Query',
      'Executes SQL queries against SQLite databases, with read-only access for safety.',
      Icon.FileSearch,
      {
        properties: {
          query: {
            description: 'SQL query to execute (SELECT statements only for safety)',
            type: Type.STRING,
          },
          database: {
            description: 'Database file path (optional, defaults to wafer.db in target directory)',
            type: Type.STRING,
          },
          limit: {
            description: 'Maximum number of rows to return (default: 100)',
            type: Type.NUMBER,
          },
        },
        required: ['query'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: SQLiteQueryToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.query || params.query.trim() === '') {
      return 'query cannot be empty';
    }

    // Safety check: only allow SELECT statements and some basic commands
    const trimmedQuery = params.query.trim().toLowerCase();
    const allowedPrefixes = [
      'select',
      'with',
      'explain',
      'pragma table_info',
      'pragma table_list',
      'pragma schema_version',
      '.schema',
      '.tables',
      '.indexes'
    ];
    
    const isAllowed = allowedPrefixes.some(prefix => trimmedQuery.startsWith(prefix));
    if (!isAllowed) {
      return 'Only SELECT queries and schema inspection commands are allowed for safety';
    }

    if (params.limit !== undefined && (params.limit < 1 || params.limit > 1000)) {
      return 'limit must be between 1 and 1000';
    }

    return null;
  }

  getDescription(params: SQLiteQueryToolParams): string {
    if (!params || !params.query) {
      return 'Execute SQLite query';
    }
    const queryPreview = params.query.length > 50 
      ? params.query.substring(0, 50) + '...' 
      : params.query;
    return `Execute query: ${queryPreview}`;
  }

  async execute(
    params: SQLiteQueryToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    try {
      const results = await this.executeQuery(
        params.query.trim(),
        params.database,
        params.limit || 100,
      );

      const resultText = this.formatQueryResults(results, params.query);

      return {
        llmContent: resultText,
        returnDisplay: resultText,
      };
    } catch (error) {
      const errorMessage = `Failed to execute query: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
      };
    }
  }

  private async executeQuery(
    query: string,
    databasePath?: string,
    limit: number = 100,
  ): Promise<QueryRow[]> {
    return new Promise((resolve, reject) => {
      const dbPath = databasePath || path.join(
        this.config.getTargetDir(),
        'wafer.db',
      );

      // Check if database file exists
      try {
        if (!fs.existsSync(dbPath)) {
          reject(new Error(`Database file not found at path: ${dbPath}`));
          return;
        }
      } catch (err) {
        reject(new Error(`Error checking database file: ${err}`));
        return;
      }

      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

      // Handle special dot commands
      if (query.toLowerCase().startsWith('.')) {
        this.handleDotCommand(db, query)
          .then(results => {
            db.close();
            resolve(results);
          })
          .catch(error => {
            db.close();
            reject(error);
          });
        return;
      }

      // Add LIMIT clause if not present for SELECT queries
      let finalQuery = query;
      if (query.toLowerCase().startsWith('select') && 
          !query.toLowerCase().includes('limit')) {
        finalQuery = `${query} LIMIT ${limit}`;
      }

      db.all(finalQuery, [], (err: Error | null, rows: QueryRow[]) => {
        db.close();
        
        if (err) {
          reject(new Error(`Query failed: ${err.message}`));
          return;
        }

        resolve(rows || []);
      });
    });
  }

  private async handleDotCommand(db: sqlite3.Database, command: string): Promise<QueryRow[]> {
    return new Promise((resolve, reject) => {
      const cmd = command.toLowerCase().trim();
      
      if (cmd === '.tables') {
        const query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        db.all(query, [], (err: Error | null, rows: QueryRow[]) => {
          if (err) {
            reject(new Error(`Failed to list tables: ${err.message}`));
            return;
          }
          resolve(rows);
        });
      } else if (cmd === '.indexes') {
        const query = "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name";
        db.all(query, [], (err: Error | null, rows: QueryRow[]) => {
          if (err) {
            reject(new Error(`Failed to list indexes: ${err.message}`));
            return;
          }
          resolve(rows);
        });
      } else if (cmd === '.schema') {
        const query = "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name";
        db.all(query, [], (err: Error | null, rows: QueryRow[]) => {
          if (err) {
            reject(new Error(`Failed to get schema: ${err.message}`));
            return;
          }
          resolve(rows);
        });
      } else {
        reject(new Error(`Unsupported dot command: ${command}`));
      }
    });
  }

  private formatQueryResults(results: QueryRow[], query: string): string {
    if (results.length === 0) {
      return `Query executed successfully. No results returned.\n\nQuery: ${query}`;
    }

    const header = `Query returned ${results.length} row${results.length === 1 ? '' : 's'}:\n`;
    
    // Get column names from first result
    const columns = Object.keys(results[0]);
    
    // Create table-like output
    const rows = results.map((row, index) => {
      const values = columns.map(col => {
        const value = row[col];
        if (value === null) return 'NULL';
        if (typeof value === 'string' && value.length > 100) {
          return value.substring(0, 100) + '...';
        }
        return String(value);
      });
      
      return `${index + 1}. ${columns.map((col, i) => `${col}: ${values[i]}`).join(' | ')}`;
    }).join('\n');

    const footer = results.length >= 100 ? '\n\n(Results may be truncated at 100 rows)' : '';
    
    return `${header}\n${rows}${footer}\n\nQuery: ${query}`;
  }
}