import ImapConfig from './interfaces/ImapConfig.interface';
import { EventEmitter } from 'events';
import {
  FetchMessageObject,
  ImapFlow,
  ListResponse,
  MailboxLockObject,
  SearchObject,
} from 'imapflow';
import Logger from './Logger';
import Mailbox from './interfaces/Mailbox.interface';
import Mail from './Mail';
import mailparser from 'mailparser';
import { uidsAndMailsToUids } from './utils';
import UidsList from './interfaces/UidsList.interface';

const DEFAULT_RECONNECT_INTERVAL = 1000 * 60;
const DEFAULT_MAILBOXES_INTERVAL = 1000 * 60;

export default class Imap {
  private readonly config: ImapConfig;
  private readonly eventEmitter: EventEmitter;
  private readonly logger: Logger;
  private readonly mailboxes: Map<string, Mailbox>;
  private readonly loadedMails: Mail[];

  // @ts-ignore: Property initialized in start() method
  private client: ImapFlow;

  /**
   * Await run() method before any action on this object
   * @param {ImapConfig} config Imap configuration
   */
  constructor(config: ImapConfig) {
    this.config = config;
    this.eventEmitter = new EventEmitter();
    this.logger = new Logger(config.logging);
    this.mailboxes = new Map();
    this.loadedMails = [];
  }

  /**
   * Run IMAP service
   * You should await this method before any action on Imap object
   */
  public async run() {
    await this.connect();
    this.watchErrors();
    await this.loadMailboxes();
    await this.watchMailboxes();
    setTimeout(this.emitLoadedMails.bind(this), 1000);
  }

  /**
   * Callback for on() method only for event 'deletedMail'
   *
   * @callback onCallbackNumber
   * @param {number} uid Uid of the mail that was deleted
   */

  /**
   * Callback for on() method only for event 'newMail' and 'loadedMail'
   *
   * @callback onCallbackMail
   * @param {Mail} mail Mail that was emitted
   */

  /**
   * Use callback when event is emitted
   *
   * @param {"deletedMail" | "newMail" | "loadedMail"} event Event to target
   * @param {onCallback | onCallbackMail} callback Callback to execute when event is emitted
   */
  public on(event: 'deletedMail', callback: (uid: number) => void): void;
  public on(
    event: 'newMail' | 'loadedMail',
    callback: (mail: Mail) => void,
  ): void;
  public on(
    event: 'newMail' | 'loadedMail' | 'deletedMail',
    callback: ((mail: Mail) => void) | ((uid: number) => void),
  ): void {
    switch (event) {
      case 'newMail':
        this.eventEmitter.addListener('newMail', callback);
        break;
      case 'loadedMail':
        this.eventEmitter.addListener('loadedMail', callback);
        break;
      case 'deletedMail':
        this.eventEmitter.addListener('deletedMail', callback);
        break;
    }
  }

  /**
   * Delete mails from uids or mail objects
   * @param {string} mailboxPath Mailbox path where mails to delete are
   * @param {UidsList} toDelete Mails or uids of mails to delete
   * @returns {boolean} true if mails are deleted
   */
  public async deleteMails(
    mailboxPath: string,
    toDelete: UidsList,
  ): Promise<boolean> {
    const uids = uidsAndMailsToUids(toDelete);
    const mailbox = await this.client.getMailboxLock(mailboxPath);
    if (mailbox) {
      const result = await this.client.messageDelete(uids.join(','), {
        uid: true,
      });
      if (result === true) {
        uids.map((uid) => this.eventEmitter.emit('deletedMail', uid));
      }
      mailbox.release();
      return result;
    }
    return false;
  }

  /**
   * Mark mails as seen from uids or mail object
   * @param {string} mailboxPath Mailbox path where mails to see are
   * @param {UidsList} toSee Mails or uids of mails to see
   * @returns {boolean} true if mails are marked seen
   */
  public async seeMails(
    mailboxPath: string,
    toSee: UidsList,
  ): Promise<boolean> {
    const uids = uidsAndMailsToUids(toSee);
    const mailbox = await this.client.getMailboxLock(mailboxPath);
    if (mailbox) {
      const result = await this.client.messageFlagsAdd(
        uids.join(','),
        ['\\Seen'],
        {
          uid: true,
        },
      );
      mailbox.release();
      return result;
    }
    return false;
  }

  /**
   * Mark mails as unseen from uids or mail object
   * @param {string} mailboxPath Mailbox path where mails to unsee are
   * @param {UidsList} toUnsee Mails or uids of mails to unsee
   * @returns {boolean} true if mails are marked unseen
   */
  public async unseeMails(
    mailboxPath: string,
    toUnsee: UidsList,
  ): Promise<boolean> {
    const uids = uidsAndMailsToUids(toUnsee);
    const mailbox = await this.client.getMailboxLock(mailboxPath);
    if (mailbox && uids.length > 0) {
      const result = await this.client.messageFlagsRemove(
        uids.join(','),
        ['\\Seen'],
        {
          uid: true,
        },
      );
      mailbox.release();
      return result;
    }
    return false;
  }

  private async connect() {
    try {
      this.logger.log(
        `Trying to connect to <${this.config.auth.user}>...`,
        'white',
      );
      this.client = new ImapFlow(this.config);
      await this.client.connect();
      this.logger.log(`Connected to <${this.config.auth.user}>`, 'green');
    } catch (e) {
      this.restart();
    }
  }

  private restart() {
    this.logger.log(
      `Could not connect to <${this.config.auth.user}>, check credentials and host`,
      'red',
    );
    setTimeout(
      this.run.bind(this),
      this.config.reconnectInterval || DEFAULT_RECONNECT_INTERVAL,
    );
  }

  private async watchErrors() {
    this.client.on('error', () => {
      const timeout =
        (this.config.reconnectInterval || DEFAULT_RECONNECT_INTERVAL) / 1000;
      this.logger.log(
        `Error detected. Restarting in ${timeout} seconds...`,
        'red',
      );
      setTimeout(this.run.bind(this), timeout);
    });
  }

  private async loadMailboxes() {
    const listResponses: ListResponse[] = await this.client.list();
    for (const list of listResponses) {
      const mailbox: Mailbox = {
        path: list.path,
        lastUid: await this.getLastUid(list.path, true),
      };
      this.mailboxes.set(mailbox.path, mailbox);
    }
    this.logger.log(
      `Loaded ${this.mailboxes.size} mailboxes for <${this.config.auth.user}>`,
      'green',
    );
  }

  private async watchMailboxes() {
    if (this.config.mailboxesToWatch) {
      for (const mailboxToWatch of this.config.mailboxesToWatch) {
        this.logger.log(
          `Watching mailbox [${mailboxToWatch}] every ${
            (this.config.mailboxesWatchInterval || DEFAULT_MAILBOXES_INTERVAL) /
            1000
          } seconds for <${this.config.auth.user}>`,
          'yellow',
        );
        await this.watchMailbox(mailboxToWatch);
        setInterval(
          this.watchMailbox.bind(this, mailboxToWatch),
          this.config.mailboxesWatchInterval || DEFAULT_MAILBOXES_INTERVAL,
        );
      }
    }
  }

  private async watchMailbox(mailboxToWatch: string) {
    try {
      const mailbox: Mailbox | undefined = this.mailboxes.get(mailboxToWatch);
      if (mailbox) {
        const mails: Mail[] = await this.getLastMails(mailbox);
        if (mails && mails.length > 0) {
          mailbox.lastUid = mails[mails.length - 1].uid;
          this.mailboxes.set(mailbox.path, mailbox);
          for (const mail of mails) {
            this.eventEmitter.emit('newMail', mail);
          }
        }
      }
    } catch (e) {
      this.logger.log(
        `Error while watching "${mailboxToWatch}" for <${this.config.auth.user}>, but still watching`,
        'yellow',
      );
    }
  }

  private async getNewMail(
    mailboxPath: string,
    msg: FetchMessageObject,
  ): Promise<Mail> {
    const headers = await mailparser.simpleParser(msg.headers);
    const bodyPart = msg.bodyParts.get('text');
    let parsedMail = headers;
    if (bodyPart) {
      const body = await mailparser.simpleParser(bodyPart);
      parsedMail = Object.assign(headers, body);
    }
    return new Mail(this, mailboxPath, msg, parsedMail);
  }

  private async emitLoadedMails() {
    for (const loadedMail of this.loadedMails) {
      this.eventEmitter.emit('loadedMail', loadedMail);
    }
    this.loadedMails.length = 0;
  }

  private async getLastUid(
    mailboxPath: string,
    loading = false,
  ): Promise<number> {
    let lastUid = 1;
    for (const msg of await this.search(mailboxPath, `1:*`)) {
      if (msg.uid > lastUid) {
        lastUid = msg.uid;
      }
      if (loading) {
        const mail = await this.getNewMail(mailboxPath, msg);
        this.loadedMails.push(mail);
      }
    }
    return lastUid;
  }

  private async getLastMails(mailbox: Mailbox): Promise<Mail[]> {
    const mails: Mail[] = [];
    for (const msg of await this.search(mailbox.path, `1:*`)) {
      if (msg.uid > mailbox.lastUid) {
        const mail = await this.getNewMail(mailbox.path, msg);
        mails.push(mail);
      }
    }
    return mails;
  }

  private async getLoadedMails(mailbox: Mailbox): Promise<Mail[]> {
    const mails: Mail[] = [];
    for (const msg of await this.search(mailbox.path, `1:*`)) {
      if (msg.uid > mailbox.lastUid) {
        const mail = await this.getNewMail(mailbox.path, msg);
        mails.push(mail);
      }
    }
    return mails;
  }

  // TODO
  public async getUnseenMails(mailboxPath: string): Promise<Mail[]> {
    const mails: Mail[] = [];
    for (const msg of await this.search(mailboxPath, { seen: false })) {
      const mail = await this.getNewMail(mailboxPath, msg);
      mails.push(mail);
    }
    return mails;
  }

  // TODO
  public async getSeenMails(mailboxPath: string): Promise<Mail[]> {
    const mails: Mail[] = [];
    for (const msg of await this.search(mailboxPath, { seen: true })) {
      const mail = await this.getNewMail(mailboxPath, msg);
      mails.push(mail);
    }
    return mails;
  }

  // TODO
  public async getAllMails(mailboxPath: string): Promise<Mail[]> {
    const mails: Mail[] = [];
    for (const msg of await this.search(mailboxPath, '1:*')) {
      const mail = await this.getNewMail(mailboxPath, msg);
      mails.push(mail);
    }
    return mails;
  }

  public getMailboxes(): Map<string, Mailbox> {
    return this.mailboxes;
  }

  private async search(
    mailboxPath: string,
    range: number[] | string | SearchObject,
  ): Promise<FetchMessageObject[]> {
    const msgs: FetchMessageObject[] = [];
    const mailbox: MailboxLockObject = await this.client.getMailboxLock(
      mailboxPath,
    );
    if (mailbox) {
      for await (let msg of this.client.fetch(range, {
        uid: true,
        headers: true,
        bodyParts: ['TEXT'],
      })) {
        msgs.push(msg);
      }
      mailbox.release();
    }
    return msgs;
  }
}
