import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

export function useSites() {
  return useQuery({
    queryKey: ["sites"],
    queryFn: api.sites.list,
    staleTime: 60_000,
  });
}
