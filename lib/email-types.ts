export type EmailDeliveryStatus = 'pending' | 'sending' | 'accepted' | 'failed' | 'unknown';
export type EmailDeliveryKind = 'daily' | 'test';
export interface EmailDeliveryView {
  id: string;
  kind: EmailDeliveryKind;
  editionDate: string;
  recipient: string;
  status: EmailDeliveryStatus;
  statusLabel: string;
  canRetry: boolean;
  errorMessage?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface EmailReadiness {
  deliveryReady: boolean;
  deliveryMode: 'scheduled';
  deliveryReason: string;
}
export interface EmailScheduleView {
  status: 'scheduled' | 'starting' | 'paused' | 'waiting' | 'error';
  nextRunAt: string | null;
  deliveryTime: string;
  timeZone: 'Asia/Shanghai';
  errorMessage?: string;
}
export interface EmailStatusResponse extends EmailReadiness {
  schedule?: EmailScheduleView;
  enabled: boolean;
  recipient: string;
  latest: EmailDeliveryView | null;
  deliveries: EmailDeliveryView[];
}
export interface EmailSendResponse { delivery: EmailDeliveryView; replayed: boolean }
