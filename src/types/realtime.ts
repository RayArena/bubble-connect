export interface RealtimeEvent<TData = unknown> {
  type: string;
  data: TData;
  ts: string;
}

export interface RealtimeEnvelope<TData = unknown> {
  rooms: string[];
  event: RealtimeEvent<TData>;
}
