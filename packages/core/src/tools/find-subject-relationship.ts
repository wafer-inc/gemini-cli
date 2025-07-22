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
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { dbscanClustering, groupByCluster, calculateClusterCentroid, Embedding } from '../utils/clustering.js';

/**
 * Database structure interfaces
 */
interface SourceGroup {
  id: number;
  mapping_id: number;
  vector: string | null;
  tags: string;
}

interface Source {
  id: number;
  source_text: string;
  tags: string;
  dates: string;
  group_id: number;
  alias_id: number | null;
}

interface Mapping {
  id: number;
  type: string;
  app_name: string | null;
  db_filename: string | null;
  table_name: string | null;
}

interface JoinedSourceGroup {
  sourceGroup: SourceGroup;
  source: Source;
  mapping: Mapping;
}

/**
 * Parameters for the FindSubjectRelationship tool
 */
export interface FindSubjectRelationshipToolParams {
  /**
   * Name of the first subject
   */
  subject_1: string;

  /**
   * Name of the second subject
   */
  subject_2: string;
}

/**
 * Implementation of the FindSubjectRelationship tool logic
 */
export class FindSubjectRelationshipTool extends BaseTool<
  FindSubjectRelationshipToolParams,
  ToolResult
> {
  static readonly Name: string = 'find_subject_relationship';

  constructor(private config: Config) {
    super(
      FindSubjectRelationshipTool.Name,
      'Find Subject Relationship',
      'Finds or creates a relationship summary between two subjects by analyzing their shared sources.',
      Icon.FileSearch,
      {
        properties: {
          subject_1: {
            description: 'Name of the first subject',
            type: Type.STRING,
          },
          subject_2: {
            description: 'Name of the second subject',
            type: Type.STRING,
          },
        },
        required: ['subject_1', 'subject_2'],
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(params: FindSubjectRelationshipToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.subject_1 || params.subject_1.trim() === '') {
      return 'subject_1 cannot be empty';
    }

    if (!params.subject_2 || params.subject_2.trim() === '') {
      return 'subject_2 cannot be empty';
    }

    if (params.subject_1.trim().toLowerCase() === params.subject_2.trim().toLowerCase()) {
      return 'subject_1 and subject_2 must be different';
    }

    return null;
  }

  getDescription(params: FindSubjectRelationshipToolParams): string {
    if (!params || !params.subject_1 || !params.subject_2) {
      return 'Find subject relationship';
    }
    return `Find relationship between "${params.subject_1}" and "${params.subject_2}"`;
  }

  async execute(
    params: FindSubjectRelationshipToolParams,
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
      const relationshipSummary = await this.getOrCreateSubjectRelationship(
        params.subject_1.trim(),
        params.subject_2.trim(),
      );

      const resultText = relationshipSummary || 'No shared sources found';

      return {
        llmContent: resultText,
        returnDisplay: resultText,
      };
    } catch (error) {
      const errorMessage = `Failed to get or create subject relationship: ${error instanceof Error ? error.message : 'Unknown error'}`;
      return {
        llmContent: errorMessage,
        returnDisplay: errorMessage,
      };
    }
  }

  private async getOrCreateSubjectRelationship(
    subject1Name: string,
    subject2Name: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const dbPath = path.join(
        this.config.getTargetDir(),
        'wafer.db',
      );

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

      // First, find the best matching subjects by name
      this.findSubjectIdsByName(db, subject1Name, subject2Name)
        .then(async ({ subject1Id, subject2Id }) => {
          // Ensure proper ordering for the CHECK constraint
          const [firstId, secondId] = subject1Id < subject2Id 
            ? [subject1Id, subject2Id] 
            : [subject2Id, subject1Id];

          // Try to get existing relationship
          const query = `
            SELECT relationship_summary 
            FROM subject_relationships 
            WHERE subject_1 = ? AND subject_2 = ?
          `;

          db.get(query, [firstId, secondId], async (err: Error | null, row: any) => {
            if (err) {
              db.close();
              reject(new Error(`Database query failed: ${err.message}`));
              return;
            }

            if (row && row.relationship_summary) {
              // Existing summary found
              db.close();
              resolve(row.relationship_summary);
              return;
            }

            try {
              const relationshipSummary = await this.generateRelationshipSummary(
                db,
                firstId,
                secondId,
                subject1Name,
                subject2Name,
              );

              // Update the database with the new relationship
              await this.updateSubjectRelationship(
                db,
                firstId,
                secondId,
                relationshipSummary,
              );

              db.close();
              resolve(relationshipSummary || 'No shared sources found');
            } catch (generateError) {
              db.close();
              reject(generateError);
            }
          });
        })
        .catch(error => {
          db.close();
          reject(error);
        });
    });
  }

  private async findSubjectIdsByName(
    db: sqlite3.Database,
    subject1Name: string,
    subject2Name: string,
  ): Promise<{ subject1Id: number, subject2Id: number }> {
    return new Promise((resolve, reject) => {
      // Try exact matches first
      const exactQuery = 'SELECT id, subject FROM subjects WHERE subject = ? COLLATE NOCASE';
      
      db.get(exactQuery, [subject1Name], (err1: Error | null, subject1Row: any) => {
        if (err1) {
          reject(new Error(`Failed to search for subject 1: ${err1.message}`));
          return;
        }

        db.get(exactQuery, [subject2Name], (err2: Error | null, subject2Row: any) => {
          if (err2) {
            reject(new Error(`Failed to search for subject 2: ${err2.message}`));
            return;
          }

          if (subject1Row && subject2Row) {
            // Both exact matches found
            resolve({ subject1Id: subject1Row.id, subject2Id: subject2Row.id });
            return;
          }

          // Fall back to fuzzy matching for missing subjects
          this.findBestMatchingSubjects(db, subject1Name, subject2Name, subject1Row, subject2Row)
            .then(result => resolve(result))
            .catch(error => reject(error));
        });
      });
    });
  }

  private async findBestMatchingSubjects(
    db: sqlite3.Database,
    subject1Name: string,
    subject2Name: string,
    subject1Row: any,
    subject2Row: any,
  ): Promise<{ subject1Id: number, subject2Id: number }> {
    return new Promise((resolve, reject) => {
      const fuzzyQuery = `
        SELECT id, subject,
        CASE 
          WHEN subject LIKE ? THEN 1
          WHEN subject LIKE ? THEN 2
          ELSE 3
        END as match_priority
        FROM subjects
        WHERE subject LIKE ? OR subject LIKE ?
        ORDER by match_priority, LENGTH(subject)
        LIMIT 20
      `;

      const queries: Promise<any>[] = [];

      // Search for subject 1 if not found
      if (!subject1Row) {
        const pattern1Exact = `%${subject1Name}%`;
        const pattern1Partial = `%${subject1Name.split(' ')[0]}%`;
        
        queries.push(new Promise((resolve1, reject1) => {
          db.get(fuzzyQuery, [pattern1Exact, pattern1Partial, pattern1Exact, pattern1Partial], (err: Error | null, row: any) => {
            if (err) reject1(err);
            else resolve1(row);
          });
        }));
      }

      // Search for subject 2 if not found
      if (!subject2Row) {
        const pattern2Exact = `%${subject2Name}%`;
        const pattern2Partial = `%${subject2Name.split(' ')[0]}%`;
        
        queries.push(new Promise((resolve2, reject2) => {
          db.get(fuzzyQuery, [pattern2Exact, pattern2Partial, pattern2Exact, pattern2Partial], (err: Error | null, row: any) => {
            if (err) reject2(err);
            else resolve2(row);
          });
        }));
      }

      if (queries.length === 0) {
        // Both subjects found exactly
        resolve({ subject1Id: subject1Row.id, subject2Id: subject2Row.id });
        return;
      }

      Promise.all(queries)
        .then(results => {
          const finalSubject1 = subject1Row || results[0];
          const finalSubject2 = subject2Row || results[subject1Row ? 0 : 1];

          if (!finalSubject1) {
            reject(new Error(`No matching subject found for "${subject1Name}"`));
            return;
          }
          if (!finalSubject2) {
            reject(new Error(`No matching subject found for "${subject2Name}"`));
            return;
          }

          resolve({ subject1Id: finalSubject1.id, subject2Id: finalSubject2.id });
        })
        .catch(error => reject(error));
    });
  }

  private async generateRelationshipSummary(
    db: sqlite3.Database,
    firstId: number,
    secondId: number,
    subject1Name: string,
    subject2Name: string,
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      // Use DBSCAN clustering approach to find sources
      const mainUserId = 1;
      const subjects = firstId === mainUserId ? [subject2Name] : 
                       secondId === mainUserId ? [subject1Name] : 
                       [subject1Name, subject2Name];
      
      this.dbscanClusterSubjectEmbeddings(db, subjects, 0.2, 2)
        .then(clustersWithCentroids => {
          if (clustersWithCentroids.length === 0) {
            resolve(null);
            return;
          }

          // Sample 5 sources from each cluster
          const sampledSources: string[] = [];
          for (const [clusterSources, _centroid] of clustersWithCentroids) {
            const samplesToTake = Math.min(5, clusterSources.length);
            for (let i = 0; i < samplesToTake; i++) {
              sampledSources.push(clusterSources[i].source.source_text);
            }
          }

          const sourcesText = sampledSources.join('\n');
          
          const relationshipPrompt = this.createSubjectUnderstandingPrompt(
            sourcesText,
            subject1Name,
            subject2Name,
          );

          // Call Gemini to generate the relationship summary
          this.callGeminiForRelationshipSummary(relationshipPrompt)
            .then(summary => resolve(summary))
            .catch(error => reject(error));
        })
        .catch(error => reject(error));
    });
  }

  /**
   * Perform DBSCAN clustering on the subject's embeddings and return clusters with centroids
   * This mirrors the Rust dbscan_cluster_subject_embeddings function
   */
  private async dbscanClusterSubjectEmbeddings(
    db: sqlite3.Database,
    subjects: string[],
    eps: number,
    minPoints: number,
  ): Promise<Array<[JoinedSourceGroup[], Embedding]>> {
    return new Promise((resolve, reject) => {
      if (subjects.length === 0) {
        resolve([]);
        return;
      }

      // Build dynamic IN clause like the Rust code
      const placeholders = subjects.map((_, i) => `?${i + 1}`).join(', ');
      const wantCount = subjects.length;

      const sql = `
        SELECT
          s.id AS source_id, s.source_text, s.tags AS source_tags, s.dates, s.group_id, s.alias_id,
          g.id AS source_group_id, g.mapping_id, g.vector, g.tags AS group_tags,
          m.id AS mapping_id, m.type, m.app_name, m.db_filename, m.table_name
        FROM sources s
        JOIN source_groups g ON s.group_id = g.id
        JOIN source_subjects ss ON s.id = ss.source_id
        JOIN subjects sub ON ss.subject_id = sub.id
        LEFT JOIN mappings m ON g.mapping_id = m.id
        WHERE LOWER(sub.subject) IN (${placeholders})
          AND g.vector IS NOT NULL
        GROUP BY s.id
        HAVING COUNT(DISTINCT LOWER(sub.subject)) = ?
        ORDER BY s.id
      `;

      const lowered = subjects.map(s => s.toLowerCase());
      const params = [...lowered, wantCount];

      db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(new Error(`Failed to get source groups: ${err.message}`));
          return;
        }

        if (!rows || rows.length === 0) {
          resolve([]);
          return;
        }

        try {
          // Convert rows to JoinedSourceGroup objects
          const sourceGroups: Array<{ group: JoinedSourceGroup; vector: Embedding }> = [];
          
          for (const row of rows) {
            if (!row.vector) continue;
            
            const vector: Embedding = JSON.parse(row.vector);
            const joinedGroup: JoinedSourceGroup = {
              sourceGroup: {
                id: row.source_group_id,
                mapping_id: row.mapping_id,
                vector: row.vector,
                tags: row.group_tags,
              },
              source: {
                id: row.source_id,
                source_text: row.source_text,
                tags: row.source_tags,
                dates: row.dates,
                group_id: row.group_id,
                alias_id: row.alias_id,
              },
              mapping: {
                id: row.mapping_id,
                type: row.type,
                app_name: row.app_name,
                db_filename: row.db_filename,
                table_name: row.table_name,
              },
            };
            
            sourceGroups.push({ group: joinedGroup, vector });
          }

          if (sourceGroups.length === 0) {
            resolve([]);
            return;
          }

          // Perform DBSCAN clustering
          const vectors = sourceGroups.map(sg => sg.vector);
          const clusterIds = dbscanClustering(vectors, eps, minPoints);
          
          // Group by cluster
          const clusters = groupByCluster(sourceGroups, clusterIds);
          
          // Build return value: clusters with centroids like Rust code
          const out: Array<[JoinedSourceGroup[], Embedding]> = [];
          for (const [clusterId, clusterItems] of clusters) {
            const sources = clusterItems.map(item => item.group);
            const clusterVectors = clusterItems.map(item => item.vector);
            const centroid = calculateClusterCentroid(clusterVectors);
            
            if (centroid) {
              out.push([sources, centroid]);
            }
          }

          resolve(out);
        } catch (parseError) {
          reject(new Error(`Failed to process clustering: ${parseError}`));
        }
      });
    });
  }

  private async updateSubjectRelationship(
    db: sqlite3.Database,
    firstId: number,
    secondId: number,
    relationshipSummary: string | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const updateQuery = `
        INSERT INTO subject_relationships (subject_1, subject_2, relationship_summary, updated_at) 
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(subject_1, subject_2) 
        DO UPDATE SET 
            relationship_summary = excluded.relationship_summary,
            updated_at = datetime('now')
      `;

      db.run(updateQuery, [firstId, secondId, relationshipSummary], function(err: Error | null) {
        if (err) {
          reject(new Error(`Failed to update relationship: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private async callGeminiForRelationshipSummary(prompt: string): Promise<string> {
    try {
      const geminiClient = this.config.getGeminiClient();
      const result = await geminiClient.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {},
        AbortSignal.timeout(30000) // 30 second timeout
      );
      
      const relationshipSummary = getResponseText(result);
      return relationshipSummary || 'Unable to generate relationship summary';
    } catch (error) {
      throw new Error(`Failed to generate relationship summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private createSubjectUnderstandingPrompt(
    sources: string,
    subject1: string,
    subject2: string,
  ): string {
    const isMainUserInvolved = subject1 === 'Sam Hall' || subject2 === 'Sam Hall';
    const mainUser = 'Sam Hall';
    const otherSubject = subject1 === mainUser ? subject2 : subject1;

    if (isMainUserInvolved) {
      return `
        ### Your job is to understand the relationship between the main user, ${mainUser}, and the person being referenced: ${otherSubject}.

        ### Context:
        - The 'Sources' you're being shown are from various databases with various Android applications belonging to ${mainUser}.
        - The data was sampled to have high variance and is not representative of the entirety of the data.
        - Since ${otherSubject} appears in ${mainUser}'s data, they have some relationship to ${mainUser}.

        ### Instructions:
        - Provide a concise yet versatile description of the relationship between ${mainUser} and ${otherSubject}.
        - Keep descriptions roughly a paragraph long (there should never be any newlines in your description).
        - Don't use any filler language.
        - Never introduce any bias or opinion; they should be purely factual.

        ### Sources:
        ${sources}`;
    } else {
      return `
        ### Your job is to understand the relationship between ${subject1} and ${subject2}.

        ### Context:
        - The 'Sources' you're being shown are from various databases with various Android applications.
        - The data was sampled to have high variance and is not representative of the entirety of the data.

        ### Instructions:
        - Provide a concise yet versatile description of the relationship between ${subject1} and ${subject2}.
        - Keep descriptions roughly a paragraph long (there should never be any newlines in your description).
        - Don't use any filler language.
        - Never introduce any bias or opinion; they should be purely factual.

        ### Sources:
        ${sources}`;
    }
  }
}