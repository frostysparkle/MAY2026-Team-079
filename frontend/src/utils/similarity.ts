/**
 * Pure TypeScript vector similarity calculations for client-side recommendations.
 * 
 * The backend generates embeddings when events/workshops are created or updated.
 * The frontend fetches those embeddings and calculates cosine similarity here,
 * client-side, to rank recommendations without backend API calls.
 */

/**
 * Calculate cosine similarity between two embedding vectors.
 * 
 * Returns a value between 0 and 1, where:
 * - 1.0 = identical vectors (perfect match)
 * - 0.0 = no similarity (orthogonal vectors or zero vector)
 * 
 * Handles zero vectors gracefully: if either vector is all zeros,
 * returns 0.0 rather than throwing a division-by-zero error.
 * This matches the backend's behavior for participants who have
 * never set preferences or searched.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0.0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  // Zero vector on either side
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0.0;
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

/**
 * Rank items by cosine similarity to a query embedding, highest first.
 * 
 * Each item must have an `embedding` field (number[] | null | undefined).
 * Returns the same items with a `similarity` score added, sorted by that score.
 * 
 * Items with missing embeddings get similarity=0.0 and sort to the end.
 */
export function rankBySimilarity<T extends { embedding?: number[] | null }>(
  items: T[],
  queryEmbedding: number[]
): Array<T & { similarity: number }> {
  const ranked = items.map(item => ({
    ...item,
    similarity: cosineSimilarity(queryEmbedding, item.embedding || [])
  }));

  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked;
}
