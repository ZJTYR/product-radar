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
  deliveryMode: 'after_update';
  deliveryReason: string;
}
export interface EmailStatusResponse extends EmailReadiness {
  enabled: boolean;
  recipient: string;
  latest: EmailDeliveryView | null;
  deliveries: EmailDeliveryView[];
}
export interface EmailSendResponse { delivery: EmailDeliveryView; replayed: boolean }
