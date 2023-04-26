'use strict';

const watt = require('gigawatts');

class Events {
  constructor(busClient, log, orcName, routing, msgContext) {
    this._busClient = busClient;
    this._orcName = orcName;
    this._routing = routing;
    this._msgContext = msgContext;

    this.status = (this._busClient && this._busClient.events.status) || {};
  }

  set msgContext(value) {
    this._msgContext = value;
  }

  get routing() {
    return this._routing;
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

  subscribe(topic, handler, xcraftRPC = false) {
    if (!this._busClient) {
      this._log.err('events.subscribe not available');
      return;
    }

    return this._busClient.events.subscribe(
      this._fixTopic(topic),
      handler,
      undefined,
      this._orcName,
      {xcraftRPC}
    );
  }

  unsubscribeAll(topic) {
    if (!this._busClient) {
      this._log.err('events.unsubscribe not available');
      return;
    }

    this._busClient.events.unsubscribe(this._fixTopic(topic));
  }

  send(topic, data, serialize, forwarding = null, context = null) {
    if (!this._busClient) {
      this._log.err('events.send not available');
      return;
    }

    let routing = this._routing;
    if (forwarding) {
      switch (typeof forwarding) {
        case 'string': {
          const appId = forwarding;
          if (appId) {
            /* FIXME: not sure if it's still used. If yes, we must provide the tribe number
             * in order to be right.
             */
            routing = Object.assign(
              {forwarding: {router: 'ee', appId}},
              this._routing
            );
          }
          break;
        }
        case 'object': {
          routing = forwarding;
          break;
        }
      }
    }

    this._busClient.events.send(
      this._fixTopic(topic),
      data,
      serialize,
      routing,
      context || this._msgContext
    );
  }
}

class Command {
  constructor(busClient, log, orcName, msgContext) {
    this._log = log;
    this._busClient = busClient;
    this._orcName = orcName;
    this._msgContext = msgContext;
  }

  set msgContext(value) {
    this._msgContext = value;
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
    this._busClient.command.send(
      cmd,
      data,
      orcName,
      finishHandler,
      options,
      this._msgContext
    );
  }

  send(cmd, data, finishHandler) {
    this._send(cmd, data, null, finishHandler);
  }

  nestedSend(cmd, data, finishHandler) {
    this._send(cmd, data, {forceNested: true}, finishHandler);
  }
}

class Resp {
  constructor(
    busClient,
    moduleName,
    orcName,
    routing = null,
    msgContext = null
  ) {
    this._busClient = busClient;
    this._orcName = orcName;
    /* Add a way for sending with the token server instead of an orcName */
    if (orcName === 'token') {
      const token = this._busClient.getToken();
      if (token === 'invalid') {
        throw new Error(
          'A Resp cannot be created with a disconnected busClient (invalid token)'
        );
      }
      orcName = 'greathall@' + token;
    }

    this.log = require('xcraft-core-log')(moduleName, this);
    this.events = new Events(busClient, this.log, orcName, routing, msgContext);
    this.command = new Command(busClient, this.log, orcName, msgContext);

    watt.wrapAll(this, 'connect', 'stop');
  }

  set msgContext(value) {
    this.events.msgContext = value;
    this.command.msgContext = value;
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

  onOrcnameChanged(callback) {
    this._busClient.on('orcname.changed', callback);
    return () => this._busClient.removeListener('orcname.changed', callback);
  }

  /**
   * @brief Listener for reconnection
   *
   * Pass 'attempt' when it tries to reconnect and 'done'
   * when it's connected again.
   *
   * @param {*} callback - Callback
   * @returns {*} unsub
   */
  onReconnect(callback) {
    this._busClient
      .on('reconnect', () => callback('done'))
      .on('reconnect attempt', () => callback('attempt'));
    return () => {
      this._busClient.removeListener('reconnect', callback);
      this._busClient.removeListener('reconnect attempt', callback);
    };
  }

  onCommandsRegistry(callback, data) {
    const _callback = () => callback(null, data);
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
    return this._busClient ? this._busClient.getCommandsNames() : {};
  }

  hasCommand(cmdName) {
    return this._busClient
      ? !!this._busClient.getCommandsRegistry()[cmdName]
      : false;
  }
}

module.exports = Resp;
