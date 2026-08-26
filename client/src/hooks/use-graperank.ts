import { useState, useEffect, useRef } from "react";
import { fetchGrapeRankScore, fetchSelfGrapeRank, fetchConnectionScores, type GrapeRankScore, type ConnectionScoresResult } from "@/lib/graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";

interface UseGrapeRankResult {
  score: GrapeRankScore | null;
  loading: boolean;
  error: boolean;
}

export function useGrapeRank(targetPubkey: string | null, observerPubkey: string | null): UseGrapeRankResult {
  const { injectScores } = useGrapeRankScores();
  const [score, setScore] = useState<GrapeRankScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!targetPubkey) {
      setScore(null);
      setLoading(false);
      setError(false);
      return;
    }

    const id = ++abortRef.current;
    setLoading(true);
    setError(false);

    fetchGrapeRankScore(targetPubkey, observerPubkey)
      .then((result) => {
        if (id !== abortRef.current || !mountedRef.current) return;
        setScore(result);
        setLoading(false);
        if (result && result.influence !== null && targetPubkey) {
          injectScores(new Map([[targetPubkey, result.influence]]));
        }
      })
      .catch(() => {
        if (id !== abortRef.current || !mountedRef.current) return;
        setError(true);
        setLoading(false);
      });
  }, [targetPubkey, observerPubkey]);

  return { score, loading, error };
}

interface UseSelfGrapeRankResult {
  influence: number | null;
  lastCalculated: string | null;
  lastTriggered: string | null;
  loading: boolean;
}

export function useSelfGrapeRank(observerPubkey: string | null): UseSelfGrapeRankResult {
  const { refreshVersion } = useGrapeRankScores();
  const [data, setData] = useState<{ influence: number | null; lastCalculated: string | null; lastTriggered: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);
  const lastRefreshRef = useRef(refreshVersion);
  const versionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (refreshVersion !== lastRefreshRef.current) {
      lastRefreshRef.current = refreshVersion;
      fetchedRef.current = null;
    }
    if (!observerPubkey || fetchedRef.current === observerPubkey) return;
    fetchedRef.current = observerPubkey;
    const id = ++versionRef.current;
    setLoading(true);

    fetchSelfGrapeRank(observerPubkey)
      .then((result) => {
        if (id !== versionRef.current || !mountedRef.current) return;
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (id !== versionRef.current || !mountedRef.current) return;
        setLoading(false);
      });
  }, [observerPubkey, refreshVersion]);

  return {
    influence: data?.influence ?? null,
    lastCalculated: data?.lastCalculated ?? null,
    lastTriggered: data?.lastTriggered ?? null,
    loading,
  };
}

interface UseConnectionScoresResult {
  scores: Map<string, number> | null;
  lastCalculated: string | null;
  loading: boolean;
}

export function useConnectionScores(targetPubkey: string | null, observerPubkey?: string | null): UseConnectionScoresResult {
  const { refreshVersion } = useGrapeRankScores();
  const authPk = observerPubkey ?? targetPubkey;
  const [data, setData] = useState<ConnectionScoresResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedKeyRef = useRef<string | null>(null);
  const lastRefreshRef = useRef(refreshVersion);
  const versionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (refreshVersion !== lastRefreshRef.current) {
      lastRefreshRef.current = refreshVersion;
      fetchedKeyRef.current = null;
    }
    if (!targetPubkey || !authPk) {
      setData(null);
      setLoading(false);
      fetchedKeyRef.current = null;
      return;
    }
    const fetchKey = `${targetPubkey}:${authPk}`;
    if (fetchedKeyRef.current === fetchKey) return;
    fetchedKeyRef.current = fetchKey;
    const id = ++versionRef.current;
    setLoading(true);

    fetchConnectionScores(targetPubkey, authPk)
      .then((result) => {
        if (id !== versionRef.current || !mountedRef.current) return;
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (id !== versionRef.current || !mountedRef.current) return;
        setLoading(false);
      });
  }, [targetPubkey, authPk, refreshVersion]);

  return {
    scores: data?.scores ?? null,
    lastCalculated: data?.lastCalculated ?? null,
    loading,
  };
}
