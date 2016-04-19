'use strict';


class Events {
  constructor (busClient, log, orcName) {
    this._busClient = busClient;
    this._orcName   = orcName;

    this.status = this._busClient && this._busClient.events.status || {};
  }

  catchAll (handler) {
    if (!this._busClient) {
      this._log.err ('events.catchAll not available');
      return;
    }
    this._busClient.events.catchAll (handler);
  }

  subscribe (topic, handler) {
    if (!this._busClient) {
      this._log.err ('events.subscribe not available');
      return;
    }

    if (!/.*::.*/.test (topic)) {
      topic = `${this._orcName}::${topic}`;
    }

    this._busClient.events.subscribe (topic, handler);
  }

  unsubscribe (topic) {
    if (!this._busClient) {
      this._log.err ('events.unsubscribe not available');
      return;
    }

    if (!/.*::.*/.test (topic)) {
      topic = `${this._orcName}::${topic}`;
    }

    this._busClient.events.unsubscribe (topic);
  }

  send (topic, data, serialize) {
    if (!this._busClient) {
      this._log.err ('events.send not available');
      return;
    }

    if (!/.*::.*/.test (topic)) {
      topic = `${this._orcName}::${topic}`;
    }

    this._busClient.events.send (topic, data, serialize);
  }
}

class Command {
  constructor (busClient, log, orcName) {
    this._log       = log;
    this._busClient = busClient;
    this._orcName   = orcName;
  }

  send (cmd, data, finishHandler) {
    if (!this._busClient) {
      this._log.err ('command.send not available');
      return;
    }

    this._busClient.command.send (cmd, data, this._orcName, finishHandler);
  }
}

class Resp {
  constructor (busClient, moduleName, orcName) {
    this._busClient = busClient;

    this.log     = require ('xcraft-core-log') (moduleName, this);
    this.events  = new Events (busClient, this.log, orcName);
    this.command = new Command (busClient, this.log, orcName);
  }

  isConnected () {
    return this._busClient ? this._busClient.isConnected () : false;
  }
}

module.exports = Resp;
