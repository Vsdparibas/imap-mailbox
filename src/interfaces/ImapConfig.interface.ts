import { ImapFlowOptions } from 'imapflow';

export default interface ImapConfig extends ImapFlowOptions {
  logging?: boolean;
  reconnectInterval?: number;
  mailboxesToWatch?: string[];
  mailboxesWatchInterval?: number;
}
