import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

export function useBrowse(siteName: string, parentId?: number) {
  return useQuery({
    queryKey: ["browse", siteName, parentId],
    queryFn: () => api.browse.get(siteName, parentId),
    staleTime: 30_000,
    enabled: !!siteName,
  });
}

export function useSearch(siteName: string, query: string) {
  return useQuery({
    queryKey: ["search", siteName, query],
    queryFn: () => api.browse.search(siteName, query),
    staleTime: 15_000,
    enabled: !!siteName && query.trim().length >= 2,
  });
}
