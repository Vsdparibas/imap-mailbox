import { FetchMessageObject } from 'imapflow';
import { AddressObject, ParsedMail } from 'mailparser';
import Imap from './Imap';

export default class Mail {
  private readonly imap: Imap;
  uid: number;
  seq: number;
  subject: string;
  from: AddressObject | undefined;
  content: string;
  mailboxPath: string;
  parsedMail: ParsedMail;

  constructor(
    imap: Imap,
    mailboxPath: string,
    msg: FetchMessageObject,
    parsedMail: ParsedMail,
  ) {
    this.imap = imap;
    this.uid = msg.uid;
    this.seq = msg.seq;
    this.subject = parsedMail.subject || '';
    this.from = parsedMail.from;
    this.content = this.parseContent(parsedMail.text || '');
    this.mailboxPath = mailboxPath;
    this.parsedMail = parsedMail;
  }

  public async delete() {
    this.imap.deleteMails(this.mailboxPath, { uids: [this.uid] });
  }

  public async see() {
    this.imap.seeMails(this.mailboxPath, { uids: [this.uid] });
  }

  public async unsee() {
    this.imap.unseeMails(this.mailboxPath, { uids: [this.uid] });
  }

  private parseContent(content: string) {
    try {
      if (content !== undefined) {
        const textLines = content.split('\n');
        textLines.pop();
        const separator = textLines[textLines.length - 1].slice(0, -2);
        const separatedText = content.split(separator)[0];
        return separatedText.trim();
      }
    } catch (e) {
      return '';
    }
    return '';
  }
}
