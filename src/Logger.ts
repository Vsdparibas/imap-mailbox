import chalk, { ForegroundColor } from 'chalk';

export default class Logger {
  private logging: boolean;

  constructor(logging: boolean = false) {
    this.logging = logging;
  }

  public log(message: string, color: typeof ForegroundColor = 'white') {
    if (this.logging) {
      const title = chalk[color]('[ImapMailbox]');
      let date = new Date(Date.now()).toLocaleString();
      date = chalk.white(date);
      message = chalk[color](message);
      console.log(`${title} - ${date} - ${message}`);
    }
  }
}
