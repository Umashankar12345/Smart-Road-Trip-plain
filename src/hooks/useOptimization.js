import { useState, useEffect, useCallback } from 'react';

export const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Simple in-memory cache hook
const cache = new Map();

export const useCache = () => {
  const getCachedData = useCallback((key) => {
    return cache.get(key);
  }, []);

  const setCachedData = useCallback((key, data) => {
    cache.set(key, data);
  }, []);

  return { getCachedData, setCachedData };
};
