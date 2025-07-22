/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type Embedding = number[];

/**
 * Calculate Euclidean distance between two embeddings
 */
export function euclideanDistance(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same length');
  }
  
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Calculate centroid of a group of embeddings
 */
export function calculateClusterCentroid(embeddings: Embedding[]): Embedding | null {
  if (embeddings.length === 0) return null;
  
  const dimensions = embeddings[0].length;
  const centroid = new Array(dimensions).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }
  
  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

/**
 * DBSCAN clustering algorithm
 * @param embeddings Array of embeddings to cluster
 * @param eps Maximum distance between points in the same cluster
 * @param minPoints Minimum number of points required to form a dense region
 * @returns Array of cluster IDs (-1 for noise/outliers)
 */
export function dbscanClustering(embeddings: Embedding[], eps: number, minPoints: number): number[] {
  const n = embeddings.length;
  const clusters = new Array(n).fill(-1); // -1 means unprocessed/noise
  let clusterId = 0;
  
  for (let i = 0; i < n; i++) {
    if (clusters[i] !== -1) continue; // Already processed
    
    const neighbors = getNeighbors(embeddings, i, eps);
    
    if (neighbors.length < minPoints) {
      // Mark as noise (will remain -1)
      continue;
    }
    
    // Start new cluster
    clusters[i] = clusterId;
    const neighborQueue = [...neighbors];
    
    // Process all neighbors
    for (let j = 0; j < neighborQueue.length; j++) {
      const neighborIdx = neighborQueue[j];
      
      if (clusters[neighborIdx] === -1) {
        // Previously marked as noise, now part of cluster
        clusters[neighborIdx] = clusterId;
        
        const neighborNeighbors = getNeighbors(embeddings, neighborIdx, eps);
        if (neighborNeighbors.length >= minPoints) {
          // Add new neighbors to queue
          for (const newNeighbor of neighborNeighbors) {
            if (!neighborQueue.includes(newNeighbor)) {
              neighborQueue.push(newNeighbor);
            }
          }
        }
      }
    }
    
    clusterId++;
  }
  
  return clusters;
}

/**
 * Get all neighbors within eps distance of a point
 */
function getNeighbors(embeddings: Embedding[], pointIdx: number, eps: number): number[] {
  const neighbors: number[] = [];
  const point = embeddings[pointIdx];
  
  for (let i = 0; i < embeddings.length; i++) {
    if (i !== pointIdx && euclideanDistance(point, embeddings[i]) <= eps) {
      neighbors.push(i);
    }
  }
  
  return neighbors;
}

/**
 * Group clustered items by cluster ID
 */
export function groupByCluster<T>(items: T[], clusterIds: number[]): Map<number, T[]> {
  const clusters = new Map<number, T[]>();
  
  for (let i = 0; i < items.length; i++) {
    const clusterId = clusterIds[i];
    if (clusterId !== -1) { // Skip noise points
      if (!clusters.has(clusterId)) {
        clusters.set(clusterId, []);
      }
      clusters.get(clusterId)!.push(items[i]);
    }
  }
  
  return clusters;
}