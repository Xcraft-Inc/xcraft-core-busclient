'use strict';

class Events {
  constructor(busClient, log, orcName) {
    this._busClient = busClient;
    this._orcName = orcName;

    this.status = (this._busClient && this._busClient.events.status) || {};
  }

  _fixTopic(topic) {
    return topic.includes('::') ? topic : `${this._orcName}::${topic}`;
  }

  catchAll(handler) {
    if (!this._busClient) {
      this._log.err('events.catchAll not available');
      return;
    }
    this._busClient.events.catchAll(handler);
  }

  subscribe(topic, handler) {
    if (!this._busClient) {
      this._log.err('events.subscribe not available');
      return;
    }

    return this._busClient.events.subscribe(this._fixTopic(topic), handler);
  }

  unsubscribeAll(topic) {
    if (!this._busClient) {
      this._log.err('events.unsubscribe not available');
      return;
    }

    this._busClient.events.unsubscribe(this._fixTopic(topic));
  }

  send(topic, data, serialize) {
    if (!this._busClient) {
      this._log.err('events.send not available');
      return;
    }

    this._busClient.events.send(this._fixTopic(topic), data, serialize);
  }
}

class Command {
  constructor(busClient, log, orcName) {
    this._log = log;
    this._busClient = busClient;
    this._orcName = orcName;
  }

  retry(msg) {
    if (!this._busClient) {
      this._log.err('command.retry not available');
      return;
    }

    this._busClient.command.retry(msg);
  }

  send(cmd, data, finishHandler) {
    if (!this._busClient) {
      this._log.err('command.send not available');
      return;
    }

    const orcName = (data && data.$orcName) || this._orcName;
    this._busClient.command.send(cmd, data, orcName, finishHandler);
  }
}

class Resp {
  constructor(busClient, moduleName, orcName) {
    this._busClient = busClient;

    this.log = require('xcraft-core-log')(moduleName, this);
    this.events = new Events(busClient, this.log, orcName);
    this.command = new Command(busClient, this.log, orcName);
  }

  isConnected() {
    return this._busClient ? this._busClient.isConnected() : false;
  }

  onCommandsRegistry(callback) {
    this._busClient.on('commands.registry', callback);
    return () => this._busClient.removeListener('commands.registry', callback);
  }

  getCommandsRegistry() {
    return this._busClient ? this._busClient.getCommandsRegistry() : [];
  }

  getCommandsRegistryTime() {
    return this._busClient ? this._busClient.getCommandsRegistryTime() : 0;
  }
}

module.exports = Resp;
