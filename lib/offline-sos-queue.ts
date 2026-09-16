import { saveSosSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const QUEUE_KEY = 'nexus_pending_sos_requests_v1';

export type SosRequestPayload = {
  client_request_id: string;
  full_name: string;
  phone: string;
  province: string;
  district: string;
  sub_district: string;
  address_details: string | null;
  lat: number | null;
  lng: number | null;
  adult_count: number;
  child_count: number;
  elder_count: number;
  urgency_level: 'low' | 'medium' | 'high' | 'critical';
  water_level: number;
  special_needs: string | null;
  needed_items: string[];
  status: 'pending';
};

type PendingSosRequest = {
  queued_at: string;
  payload: SosRequestPayload;
};

function readQueue(): PendingSosRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingSosRequest[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event('nexus:sos-queue-changed'));
}

export function getPendingSosCount() {
  return readQueue().length;
}

export function queueSosRequest(payload: SosRequestPayload) {
  const queue = readQueue();
  if (!queue.some((item) => item.payload.client_request_id === payload.client_request_id)) {
    queue.push({ payload, queued_at: new Date().toISOString() });
    writeQueue(queue);
  }
}

export function isNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|network is unreachable/i.test(message);
}

export async function submitSosRequest(payload: SosRequestPayload) {
  const { data, error } = await supabase
    .from('sos_reports')
    .insert([payload])
    .select('id')
    .single();

  if (error?.code === '23505') {
    const { data: existingRequest, error: existingRequestError } = await supabase
      .from('sos_reports')
      .select('id')
      .eq('client_request_id', payload.client_request_id)
      .maybeSingle();
    if (!existingRequestError && existingRequest) return existingRequest.id;
  }
  if (error) throw error;
  return data.id;
}

export async function syncPendingSosRequests() {
  if (typeof window === 'undefined' || !navigator.onLine) return [] as Array<{ id: string; phone: string }>;

  const queue = readQueue();
  const delivered: Array<{ id: string; phone: string }> = [];
  const remaining: PendingSosRequest[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      const id = await submitSosRequest(item.payload);
      saveSosSession(id, item.payload.phone);
      delivered.push({ id, phone: item.payload.phone });
      window.dispatchEvent(new CustomEvent('nexus:sos-sent', { detail: { id, phone: item.payload.phone } }));
    } catch (error) {
      remaining.push(item, ...queue.slice(index + 1));
      if (!isNetworkError(error)) {
        // Keep the request for a deliberate retry; the user must not lose an SOS because of a server-side validation issue.
      }
      break;
    }
  }

  writeQueue(remaining);
  return delivered;
}
