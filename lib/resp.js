'use strict';

const watt = require('gigawatts');

class Events {
  constructor(busClient, log, orcName, routing) {
    this._busClient = busClient;
    this._orcName = orcName;
    this._routing = routing;

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

    this._busClient.events.send(
      this._fixTopic(topic),
      data,
      serialize,
      this._routing
    );
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

  _send(cmd, data, options, finishHandler) {
    if (!this._busClient) {
      this._log.err('command.send not available');
      return;
    }

    const orcName = (data && data.$orcName) || this._orcName;
    this._busClient.command.send(cmd, data, orcName, finishHandler, options);
  }

  send(cmd, data, finishHandler) {
    this._send(cmd, data, null, finishHandler);
  }

  nestedSend(cmd, data, finishHandler) {
    this._send(cmd, data, {forceNested: true}, finishHandler);
  }
}

class Resp {
  constructor(busClient, moduleName, orcName, routing = null) {
    this._busClient = busClient;
    this._cmdNames = {};
    this._orcName = orcName;

    /* Add a way for sending with the token server instead of an orcName */
    if (orcName === 'token') {
      orcName = 'greathall@' + this._busClient.getToken();
    }

    this.log = require('xcraft-core-log')(moduleName, this);
    this.events = new Events(busClient, this.log, orcName, routing);
    this.command = new Command(busClient, this.log, orcName);

    watt.wrapAll(this, 'connect', 'stop');
  }

  _makeCmdNames() {
    if (!this._busClient) {
      return {};
    }
    this._cmdNames = Object.assign(
      {},
      ...Object.keys(this._busClient.getCommandsRegistry()).map((key) => {
        return {[key]: true};
      })
    );
  }

  get orcName() {
    return this._orcName;
  }

  *connect(next) {
    yield this._busClient.connect('axon', null, next);
  }

  *stop(next) {
    yield this._busClient.stop(next);
  }

  isConnected() {
    return this._busClient ? this._busClient.isConnected() : false;
  }

  onTokenChanged(callback) {
    this._busClient.on('token.changed', callback);
    return () => this._busClient.removeListener('token.changed', callback);
  }

  onCommandsRegistry(callback) {
    const _callback = () => {
      this._makeCmdNames();
      callback();
    };
    this._busClient.on('commands.registry', _callback);
    return () => this._busClient.removeListener('commands.registry', _callback);
  }

  getCommandsRegistry() {
    return this._busClient ? this._busClient.getCommandsRegistry() : {};
  }

  getCommandsRegistryTime() {
    return this._busClient ? this._busClient.getCommandsRegistryTime() : 0;
  }

  getCommandsNames() {
    this._makeCmdNames();
    return this._cmdNames;
  }
}

module.exports = Resp;
