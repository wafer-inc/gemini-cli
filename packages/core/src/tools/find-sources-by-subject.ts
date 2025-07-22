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
 * Database structure interfaces
 */
interface Source {
  id: number;
  source_text: string;
  tags: string;
  dates: string;
  group_id: number;
  alias_id: number | null;
}

interface Subject {
  id: number;
  subject: string;
  type: string;
}

interface SourceWithSubject {
  source: Source;
  subject: Subject;
  score: number;
}

/**
 * Parameters for the FindSourcesBySubject tool
 */
export interface FindSourcesBySubjectToolParams {
  /**
   * Name of the subject to find sources for
   */
  subject: string;
  
  /**
   * Maximum number of sources to return (default: 10)
   */
  limit?: number;
}

/**
 * Implementation of the FindSourcesBySubject tool logic
 */
export class FindSourcesBySubjectTool extends BaseTool<
  FindSourcesBySubjectToolParams,
  ToolResult
> {
  static readonly Name: string = 'find_sources_by_subject';

  constructor(private config: Config) {
    super(
      FindSourcesBySubjectTool.Name,
      'Find Sources by Subject',
      'Finds sources that are linked to a specific subject.',
      Icon.FileSearch,
      {
        properties: {
          subject: {
            description: 'Name of the subject to find sources for',
            type: Type.STRING,
          },
          limit: {
            description: 'Maximum number of sources to return (default: 10)',
            type: Type.NUMBER,
          },
        },
        required: ['subject'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: FindSourcesBySubjectToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.subject || params.subject.trim() === '') {
      return 'subject cannot be empty';
    }

    if (params.limit !== undefined && (params.limit < 1 || params.limit > 100)) {
      return 'limit must be between 1 and 100';
    }

    return null;
  }

  getDescription(params: FindSourcesBySubjectToolParams): string {
    if (!params || !params.subject) {
      return 'Find sources by subject';
    }
    const limit = params.limit || 10;
    return `Find ${limit} sources for subject "${params.subject}"`;
  }

  async execute(
    params: FindSourcesBySubjectToolParams,
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
      const sources = await this.findSourcesBySubject(
        params.subject.trim(),
        params.limit || 10,
      );

      if (sources.length === 0) {
        const message = `No sources found for subject "${params.subject}"`;
        return {
          llmContent: message,
          returnDisplay: message,
        };
      }

      const resultText = this.formatSourcesOutput(sources, params.subject);

      return {
        llmContent: resultText,
        returnDisplay: resultText,
      };
    } catch (error) {
      const errorMessage = `Failed to find sources: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
      };
    }
  }

  private async findSourcesBySubject(
    subjectName: string,
    limit: number,
  ): Promise<SourceWithSubject[]> {
    return new Promise((resolve, reject) => {
      const dbPath = path.join(
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

      const db = new sqlite3.Database(dbPath);

      // First try exact match, then fall back to fuzzy matching
      this.findSubjectIdByName(db, subjectName)
        .then(subjectId => {
          if (!subjectId) {
            resolve([]);
            return;
          }

          const query = `
            SELECT 
              s.id, s.source_text, s.tags, s.dates, s.group_id, s.alias_id,
              sub.id as subject_id, sub.subject, sub.type,
              ss.score
            FROM sources s
            JOIN source_subjects ss ON s.id = ss.source_id
            JOIN subjects sub ON ss.subject_id = sub.id
            WHERE sub.id = ?
            ORDER BY ss.score DESC, s.id
            LIMIT ?
          `;

          db.all(query, [subjectId, limit], (err: Error | null, rows: any[]) => {
            db.close();
            
            if (err) {
              reject(new Error(`Database query failed: ${err.message}`));
              return;
            }

            const sources: SourceWithSubject[] = rows.map(row => ({
              source: {
                id: row.id,
                source_text: row.source_text,
                tags: row.tags,
                dates: row.dates,
                group_id: row.group_id,
                alias_id: row.alias_id,
              },
              subject: {
                id: row.subject_id,
                subject: row.subject,
                type: row.type,
              },
              score: row.score,
            }));

            resolve(sources);
          });
        })
        .catch(error => {
          db.close();
          reject(error);
        });
    });
  }

  private async findSubjectIdByName(
    db: sqlite3.Database,
    subjectName: string,
  ): Promise<number | null> {
    return new Promise((resolve, reject) => {
      // Try exact match first
      const exactQuery = 'SELECT id FROM subjects WHERE subject = ? COLLATE NOCASE';
      
      db.get(exactQuery, [subjectName], (err: Error | null, row: any) => {
        if (err) {
          reject(new Error(`Failed to search for subject: ${err.message}`));
          return;
        }

        if (row) {
          resolve(row.id);
          return;
        }

        // Fall back to fuzzy matching
        const fuzzyQuery = `
          SELECT id, subject,
          CASE 
            WHEN subject LIKE ? THEN 1
            WHEN subject LIKE ? THEN 2
            ELSE 3
          END as match_priority
          FROM subjects
          WHERE subject LIKE ? OR subject LIKE ?
          ORDER BY match_priority, LENGTH(subject)
          LIMIT 1
        `;

        const patternExact = `%${subjectName}%`;
        const patternPartial = `%${subjectName.split(' ')[0]}%`;
        
        db.get(fuzzyQuery, [patternExact, patternPartial, patternExact, patternPartial], (err2: Error | null, row2: any) => {
          if (err2) {
            reject(new Error(`Failed to fuzzy search for subject: ${err2.message}`));
            return;
          }

          resolve(row2 ? row2.id : null);
        });
      });
    });
  }

  private formatSourcesOutput(sources: SourceWithSubject[], subjectName: string): string {
    const header = `Found ${sources.length} sources for subject "${subjectName}":`;
    
    const sourcesList = sources.map((item, index) => {
      const { source, score } = item;
      const preview = source.source_text.length > 200 
        ? source.source_text.substring(0, 200) + '...' 
        : source.source_text;
      
      const tags = source.tags ? ` [${source.tags}]` : '';
      const dates = source.dates ? ` (${source.dates})` : '';
      
      return `${index + 1}. [Score: ${score.toFixed(2)}]${tags}${dates}\n   ${preview}`;
    }).join('\n\n');

    return `${header}\n\n${sourcesList}`;
  }
}