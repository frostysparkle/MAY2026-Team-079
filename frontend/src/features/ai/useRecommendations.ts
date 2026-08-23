/**
 * Client-side recommendation hook for events and workshops.
 * 
 * The backend stores embeddings on events/workshops and on each participant's profile.
 * This hook:
 * 1. Fetches the participant's saved embedding from their profile (if they typed a query before)
 * 2. Or generates a new embedding from a query string
 * 3. Calculates cosine similarity client-side against all items
 * 4. Returns items sorted by similarity (highest first)
 * 
 * The embeddings API call only happens when the user types a new query.
 * Reusing saved embeddings or sorting with no query requires no backend call.
 */

import { useState, useCallback } from "react";
import { cosineSimilarity, rankBySimilarity } from "../../utils/similarity";
import { api } from "../../api/realApi";

interface UseRecommendationsOptions<T extends { embedding?: number[] | null }> {
  items: T[];
  savedEmbedding?: number[] | null;
  onEmbeddingUpdate?: (embedding: number[]) => void;
}

interface UseRecommendationsResult<T> {
  rankedItems: Array<T & { similarity: number }>;
  isGenerating: boolean;
  error: string | null;
  rankByQuery: (query: string) => Promise<void>;
  rankBySaved: () => void;
}

/**
 * Generic recommendation hook for any item type with embeddings.
 * 
 * @param items - The full catalogue (events or workshops) with embeddings
 * @param savedEmbedding - The participant's saved preference embedding (from profile)
 * @param onEmbeddingUpdate - Callback when a new embedding is generated (to persist to profile)
 */
export function useRecommendations<T extends { embedding?: number[] | null }>({
  items,
  savedEmbedding,
  onEmbeddingUpdate,
}: UseRecommendationsOptions<T>): UseRecommendationsResult<T> {
  const [rankedItems, setRankedItems] = useState<Array<T & { similarity: number }>>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Generate embedding from query text and rank items by similarity.
   * Saves the new embedding via the callback so the parent can persist it.
   */
  const rankByQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        // Empty query: rank by saved embedding or show items unsorted
        rankBySaved();
        return;
      }

      setIsGenerating(true);
      setError(null);

      try {
        // Generate embedding for the query
        const embeddings = await api.generateEmbedding(trimmed);
        const queryEmbedding = embeddings[0] || [];

        // Notify parent so it can save to profile
        if (onEmbeddingUpdate) {
          onEmbeddingUpdate(queryEmbedding);
        }

        // Rank items by similarity
        const ranked = rankBySimilarity(items, queryEmbedding);
        setRankedItems(ranked);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate embedding");
        // Fall back to unsorted items
        setRankedItems(items.map(item => ({ ...item, similarity: 0 })));
      } finally {
        setIsGenerating(false);
      }
    },
    [items, onEmbeddingUpdate]
  );

  /**
   * Rank items by the saved embedding (no API call needed).
   * If no saved embedding exists, items are shown in their original order.
   */
  const rankBySaved = useCallback(() => {
    if (!savedEmbedding || savedEmbedding.length === 0) {
      // No saved embedding: show items unsorted (similarity = 0 for all)
      setRankedItems(items.map(item => ({ ...item, similarity: 0 })));
      return;
    }

    const ranked = rankBySimilarity(items, savedEmbedding);
    setRankedItems(ranked);
  }, [items, savedEmbedding]);

  return {
    rankedItems,
    isGenerating,
    error,
    rankByQuery,
    rankBySaved,
  };
}
