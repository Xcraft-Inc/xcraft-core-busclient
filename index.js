'use strict';

const moduleName = 'busclient';

const {
  Router,
  Cache,
  helpers: {extractIds},
} = require('xcraft-core-transport');
const {v4: uuidV4} = require('uuid');

const xLog = require('xcraft-core-log')(moduleName, null);
const xUtils = require('xcraft-core-utils');

const {EventEmitter} = require('events');
const Resp = require('./lib/resp.js');

let globalBusClient = null;

class BusClient extends EventEmitter {
  constructor(busConfig, subscriptions) {
    super();

    this._busConfig = busConfig; /* can be null */

    const id = uuidV4();
    this._subSocket = new Router(id, 'sub', xLog);
    this._pushSocket = new Router(id, 'push', xLog);

    this._eventsRegistry = {};
    this._commandsRegistry = {};
    this._eventsCache = new Cache();

    this._token = 'invalid';
    this._orcName = null;
    this._autoconnect = false;
    this._connected = false;
    this._subClosed = true;
    this._pushClosed = true;

    const Events = require('./lib/events.js');
    this.events = new Events(this, this._subSocket);

    const Command = require('./lib/command.js');
    this.command = new Command(this, this._pushSocket);

    let autoConnectToken = '';

    const subs = subscriptions || [
      'greathall::*' /* broadcasted by server */,
      'gameover' /* broadcasted by bus */,
    ];

    subs.forEach((sub) => this._subSocket.subscribe(sub));

    this._onCloseSubscribers = {};
    this._onConnectSubscribers = {};

    const onClosed = (err) => {
      if (!this._subClosed || !this._pushClosed) {
        return;
      }

      if (!err) {
        xLog.verb(`bus stopped for ${this._orcName || 'greathall'}`);
      }

      Object.keys(this._onCloseSubscribers).forEach((key) =>
        this._onCloseSubscribers[key].callback(err)
      );
    };

    const onConnected = (err) => {
      if (this._subClosed || this._pushClosed) {
        return;
      }

      if (!err) {
        xLog.verb('Connected');
      }

      Object.keys(this._onConnectSubscribers).forEach((key) =>
        this._onConnectSubscribers[key].callback(err)
      );
    };

    const onReconnectAttempt = () => {
      xLog.verb('Attempt a reconnect');

      this._connected = false;
      this._autoconnect = true;

      this._registerAutoconnect(() => {
        this.emit('reconnect');
      });
    };

    this._subSocket
      .on('close', (err) => {
        this._subClosed = true;
        onClosed(err);
      })
      .on('connect', () => {
        xLog.verb('Bus client subscribed to notifications bus');
        this._subClosed = false;
        onConnected();
      })
      .on('error', (err) => {
        this._subClosed = true;
        onClosed(err);
        onConnected(err);
      })
      .on('reconnect attempt', onReconnectAttempt);

    this._pushSocket
      .on('close', (err) => {
        this._pushClosed = true;
        onClosed(err);
      })
      .on('connect', () => {
        xLog.verb('Bus client ready to send on command bus');
        this._pushClosed = false;
        onConnected();
      })
      .on('error', (err) => {
        this._pushClosed = true;
        onClosed(err);
        onConnected(err);
      })
      .on('reconnect attempt', onReconnectAttempt);

    this._subSocket.on('message', (topic, msg) => {
      if (topic === 'gameover') {
        xLog.info('Game Over');
        this._connected = false;
        this.stop();
        return;
      }

      if (topic === 'greathall::bus.commands.registry') {
        this._commandsRegistry = msg.data.registry;
        this._commandsRegistryTime = new Date().toISOString();
        this.emit('commands.registry', null, {
          token: msg.data.token,
          time: this._commandsRegistryTime,
        });
        return;
      }

      if (topic === 'greathall::bus.token.changed') {
        this.emit('token.changed');
        return;
      }

      if (this._autoconnect && topic === 'greathall::heartbeat') {
        this._autoconnect = false;
        autoConnectToken = xUtils.crypto.genToken();
        this._subSocket.subscribe(autoConnectToken + '::autoconnect.finished');
        this.command.send(
          'autoconnect',
          {
            autoConnectToken,
            nice: this._busConfig ? this._busConfig.nice : 0,
          },
          'greathall'
        );
        return;
      }

      if (
        !this._connected &&
        topic === autoConnectToken + '::autoconnect.finished'
      ) {
        const escapeTopic = xUtils.regex.toXcraftRegExpStr(
          'autoconnect.finished'
        );
        this._connected = true;
        this._subSocket.unsubscribe(
          autoConnectToken + '::autoconnect.finished'
        );
        this._eventsRegistry[escapeTopic].handler(msg); // FIXME: replace by a getter
        this.unregisterEvents('autoconnect.finished');
        return;
      }

      const orcName = this.getOrcName() || 'greathall';

      if (msg.token !== this._token) {
        xLog.info('invalid token, event discarded');
        return;
      }

      const handlers = this._eventsCache.map(
        topic,
        (id, key) => this._eventsRegistry[key].handler
      );

      if (handlers.length) {
        xLog.verb(`notification received: ${topic} for ${orcName}`);
        handlers.forEach((handler) => handler(msg));
      } else if (topic !== 'greathall::heartbeat') {
        xLog.info(
          `event sent on ${topic} discarded (no subscriber, current orc: ${orcName})`
        );
      }
    });
  }

  _registerAutoconnect(callback, err) {
    this.registerEvents('autoconnect.finished', (msg) => {
      const isNewOrcName = this._orcName !== msg.data.orcName;

      if (this._token !== 'invalid') {
        if (this._token !== msg.data.token) {
          xLog.warn(
            `reconnecting to the server has provided a new token: ${this._token} -> ${msg.data.token}`
          );
          this.emit('token.changed');
        } else if (this._orcName && isNewOrcName) {
          xLog.warn(
            `reconnecting to the server has provided a new orcName: ${this._orcName} -> ${msg.data.orcName}`
          );
          this.emit('orcname.changed');
        }
      }

      this._token = msg.data.token;
      if (!this._orcName) {
        this._orcName = msg.data.orcName;
      }
      this._commandsRegistry = msg.data.cmdRegistry;
      this._commandsRegistryTime = new Date().toISOString();
      this.emit('commands.registry', null, {
        token: msg.data.token,
        time: this._commandsRegistryTime,
      });

      xLog.info(this._orcName + ' is serving ' + this._token + ' Great Hall');

      if (this._orcName && isNewOrcName) {
        this._subSocket.subscribe(this._orcName + '::*');
      }

      if (callback) {
        callback(err, msg.data.isLoaded);
      }
    });
  }

  _subscribeClose(callback) {
    const key = uuidV4();
    this._onCloseSubscribers[key] = {
      callback,
      unsubscribe: () => {
        delete this._onCloseSubscribers[key];
      },
    };
    return this._onCloseSubscribers[key].unsubscribe;
  }

  _subscribeConnect(callback) {
    const key = uuidV4();
    this._onConnectSubscribers[key] = {
      callback,
      unsubscribe: () => {
        delete this._onConnectSubscribers[key];
      },
    };
    return this._onConnectSubscribers[key].unsubscribe;
  }

  /**
   * Connect the client to the buses.
   *
   * When the busToken is null, the client tries to autoconnect to the server.
   * It's a trivial mechanism, there is no support for user authentication.
   *
   * The busToken must be passed only when BusClient is used on the server
   * side. In all other cases, the argument _must_ be null.
   *
   * @param {string} backend - Transport's backend (ee or axon).
   * @param {string} busToken - Server's token, or null for autoconnect.
   * @param {function(err)} callback - Callback.
   */
  connect(backend, busToken, callback) {
    xLog.verb('Connecting...');

    const unsubscribe = this._subscribeConnect((err) => {
      unsubscribe();

      if (err) {
        callback(err);
        return;
      }

      /* TODO: Explain auto-connect mecha */
      if (!busToken) {
        /* Autoconnect is sent when the server is ready (heartbeat). */
        this._registerAutoconnect(callback, err);
        this._autoconnect = true;
        return;
      }

      this._connected = true;
      this._token = busToken;
      xLog.verb('Connected with token: ' + this._token);

      callback();
    });

    let busConfig = this._busConfig;
    if (!busConfig) {
      busConfig = require('xcraft-core-etc')().load('xcraft-core-bus');
    }

    this._subSocket.connect(backend, {
      port: parseInt(busConfig.notifierPort),
      host: busConfig.host,
    });
    this._pushSocket.connect(backend, {
      port: parseInt(busConfig.commanderPort),
      host: busConfig.host,
    });
  }

  /**
   * Close the connections on the buses.
   *
   * @param {function(err)} callback - Callback.
   */
  stop(callback) {
    xLog.verb(`Stopping for ${this._orcName || 'greathall'}...`);

    const unsubscribe = this._subscribeClose((err) => {
      unsubscribe();
      if (callback) {
        callback(err);
      }
    });

    this._connected = false;
    this._subSocket.stop();
    this._pushSocket.stop();
  }

  /**
   * Return a new empty message for the commands.
   *
   * The isNested attribute is set when the command is called from the server
   * side but with an orc name.
   *
   * @param {string} topic - Event's topic or command's name.
   * @param {string} which - The sender's identity (orcName).
   * @return {Object} the new message.
   */
  newMessage(topic, which) {
    const id = uuidV4();
    const isNested =
      topic &&
      !topic.includes('::') && // is a command
      !!(this.isServerSide() && which && which !== 'greathall');

    return {
      _xcraftMessage: true,
      token: this.getToken(),
      orcName: which,
      id,
      topic,
      data: {},
      isNested,
      isError: topic && topic.endsWith('.error'),
    };
  }

  /**
   * Patch a message for re-sending to an other server.
   *
   * It's especially useful in the case of the Horde when a command must be
   * forwarded to an other server.
   *
   * @param {Object} msg - Xcraft message.
   */
  patchMessage(msg) {
    msg.token = this.getToken();
  }

  _unregister(id, escapeTopic) {
    this._eventsCache.del(id, escapeTopic);
    delete this._eventsRegistry[escapeTopic];
  }

  registerEvents(topic, handler) {
    const escapeTopic = xUtils.regex.toXcraftRegExpStr(topic);

    if (this._eventsRegistry[escapeTopic]) {
      xLog.info(`${topic} already registered, unsub and sub again`);
      this.unregisterEvents(topic);
    }

    const re = new RegExp(escapeTopic);
    const ids = extractIds(topic);
    const id = ids.length > 1 ? ids[1] : ids[0];
    this._eventsCache.set(id, escapeTopic, re);
    this._eventsRegistry[escapeTopic] = {
      topic: re,
      handler,
      unregister: () => this._unregister(id, escapeTopic),
    };
  }

  unregisterEvents(topic) {
    const escapeTopic = xUtils.regex.toXcraftRegExpStr(topic);
    this._eventsRegistry[escapeTopic].unregister();
  }

  isServerSide() {
    return !this._orcName;
  }

  getToken() {
    return this._token;
  }

  getOrcName() {
    return this._orcName;
  }

  getCommandsRegistry() {
    return this._commandsRegistry;
  }

  getCommandsRegistryTime() {
    return this._commandsRegistryTime;
  }

  isConnected() {
    return this._connected;
  }

  newResponse() {
    return exports.newResponse.apply(this, arguments);
  }

  getNice() {
    const nice = this._busConfig && this._busConfig.nice;
    return nice || 0;
  }
}

exports.newResponse = function (moduleName, orcName, routing) {
  let self = null;
  if (this instanceof BusClient) {
    self = this;
  }

  return new Resp(self, moduleName, orcName, routing);
};

exports.initGlobal = function () {
  globalBusClient = new BusClient();
  return globalBusClient;
};

exports.getGlobal = function () {
  return globalBusClient;
};

exports.BusClient = BusClient;
