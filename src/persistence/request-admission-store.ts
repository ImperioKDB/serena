export type AdmissionDecision = 'admitted' | 'rate_limited' | 'concurrency_limited';

export const API_REQUEST_LIMITS = {
  requestsPerWindow: 20,
  windowSeconds: 60,
  concurrentRequests: 2,
  leaseSeconds: 120,
} as const;

export interface RequestAdmissionStore {
  acquireRequest(requestId: string, keyHash: string): Promise<AdmissionDecision>;
  releaseRequest(requestId: string): Promise<void>;
}
