/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import sqlite3 from 'sqlite3';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { Config } from '../config/config.js';

/**
 * Parameters for the FindSimilarSubjects tool
 */
export interface FindSimilarSubjectsToolParams {
  /**
   * The subject to find similar subjects for
   */
  subject: string;

  /**
   * Optional: Maximum number of similar subjects to return
   */
  limit?: number;

  /**
   * Optional: Minimum similarity threshold (0-1)
   */
  similarity_threshold?: number;
}

/**
 * Implementation of the FindSimilarSubjects tool logic
 */
export class FindSimilarSubjectsTool extends BaseTool<
  FindSimilarSubjectsToolParams,
  ToolResult
> {
  static readonly Name: string = 'find_similar_subjects';

  constructor(private config: Config) {
    super(
      FindSimilarSubjectsTool.Name,
      'Find Similar Subjects',
      'Finds subjects in the database that are similar to the provided subject based on semantic similarity or other matching criteria.',
      Icon.FileSearch,
      {
        properties: {
          subject: {
            description: 'The subject to find similar subjects for',
            type: Type.STRING,
          },
          limit: {
            description:
              'Optional: Maximum number of similar subjects to return (default: 10)',
            type: Type.NUMBER,
          },
          similarity_threshold: {
            description:
              'Optional: Minimum similarity threshold between 0 and 1 (default: 0.5)',
            type: Type.NUMBER,
          },
        },
        required: ['subject'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: FindSimilarSubjectsToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.subject || params.subject.trim() === '') {
      return 'Subject cannot be empty';
    }

    if (
      params.limit !== undefined &&
      (params.limit <= 0 || params.limit > 100)
    ) {
      return 'Limit must be between 1 and 100';
    }

    if (
      params.similarity_threshold !== undefined &&
      (params.similarity_threshold < 0 || params.similarity_threshold > 1)
    ) {
      return 'Similarity threshold must be between 0 and 1';
    }

    return null;
  }

  getDescription(params: FindSimilarSubjectsToolParams): string {
    if (!params || !params.subject) {
      return 'Find similar subjects';
    }
    return `Find subjects similar to "${params.subject}"`;
  }

  async execute(
    params: FindSimilarSubjectsToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    // TODO: Implement actual database query logic
    // This is where you'll add your database connection and similarity search
    const limit = params.limit || 10;
    const threshold = params.similarity_threshold || 0.5;

    try {
      // Placeholder for actual implementation
      const similarSubjects = await this.findSimilarSubjectsInDatabase(
        params.subject,
        limit,
        threshold,
      );

      const resultText =
        similarSubjects.length > 0
          ? `Found ${similarSubjects.length} similar subjects:\n${similarSubjects.map((s) => `- ${s}`).join('\n')}`
          : `No similar subjects found for "${params.subject}"`;

      return {
        llmContent: resultText,
        returnDisplay: resultText,
      };
    } catch (error) {
      const errorMessage = `Failed to find similar subjects: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
      };
    }
  }

  private async findSimilarSubjectsInDatabase(
    subject: string,
    limit: number,
    threshold: number,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const dbPath = path.join(
        this.config.getTargetDir(),
        'wafer.db',
      );

      console.log(`Using database file: ${dbPath}`);

      // Check if database file exists
      try {
        const fs = require('fs');
        if (!fs.existsSync(dbPath)) {
          reject(new Error(`Database file not found at path: ${dbPath}`));
          return;
        }
      } catch (err) {
        reject(new Error(`Error checking database file: ${err}`));
        return;
      }

      const db = new sqlite3.Database(dbPath);

      // Query to find subjects that co-occur most frequently with the given subject
      const query = `
        SELECT 
          s2.subject,
          COUNT(*) as co_occurrence_count
        FROM source_subjects ss1
        JOIN subjects s1 ON ss1.subject_id = s1.id
        JOIN source_subjects ss2 ON ss1.source_id = ss2.source_id
        JOIN subjects s2 ON ss2.subject_id = s2.id
        WHERE s1.subject = ? COLLATE NOCASE
        AND s2.subject != ? COLLATE NOCASE
        GROUP BY s2.subject
        ORDER BY co_occurrence_count DESC
        LIMIT ?
      `;

      db.all(
        query,
        [subject, subject, limit],
        (err: Error | null, rows: any[]) => {
          db.close();

          if (err) {
            reject(new Error(`Database query failed: ${err.message}`));
            return;
          }

          const similarSubjects = rows.map((row) => row.subject as string);
          resolve(similarSubjects);
        },
      );
    });
  }
}
