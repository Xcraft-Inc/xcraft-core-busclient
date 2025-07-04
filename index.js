'use strict';

const moduleName = 'busclient';

const {
  Router,
  Cache,
  helpers: {extractIds},
} = require('xcraft-core-transport');
const {v4: uuidV4} = require('uuid');

const fse = require('fs-extra');
const path = require('node:path');
const xLog = require('xcraft-core-log')(moduleName, null);
const xUtils = require('xcraft-core-utils');

const {EventEmitter} = require('events');
const Resp = require('./lib/resp.js');

let globalBusClient = null;

const autoconnect = {
  no: 0,
  yes: 1,
  wait: 2,
};

class BusClient extends EventEmitter {
  #lastErrorReason = null;

  constructor(busConfig, subscriptions) {
    super();

    this._busConfig = busConfig; /* can be null */

    const id = uuidV4();
    this._subSocket = new Router(id, 'sub', xLog);
    this._pushSocket = new Router(id, 'push', xLog);

    this._eventsRegistry = {};
    this._commandsRegistry = {};
    this._commandsRegistryTime = 0;
    this._commandsNames = {};
    this._eventsCache = new Cache();

    this._token = 'invalid';
    this._orcName = null;
    this._autoconnect = autoconnect.no;
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
      if (err && err?.code !== 'Z_BUF_ERROR') {
        this.#lastErrorReason = err.code || err.message || err;
      }

      if (!this._subClosed || !this._pushClosed) {
        return;
      }

      this.emit('close');

      if (!err) {
        xLog.verb(() => `bus stopped for ${this._orcName || 'greathall'}`);
      }

      Object.keys(this._onCloseSubscribers).forEach((key) =>
        this._onCloseSubscribers[key].callback(err)
      );
    };

    const onConnected = (err) => {
      if (this._subClosed || this._pushClosed) {
        return;
      }

      this.#lastErrorReason = null;

      if (!err) {
        xLog.verb('Connected');
      }

      Object.keys(this._onConnectSubscribers).forEach((key) =>
        this._onConnectSubscribers[key].callback(err)
      );
    };

    const onReconnectAttempt = (from) => {
      if (!this._connected) {
        return;
      }

      /* Ignore reconnect attempts in case of internal Xcraft nodes
       * (localhost hordes). If an internal node is dying (or dead)
       * the system is unstable. It's better to kill everythings
       * as soon as possible.
       */
      const fromSocket = this[`_${from}Socket`];
      if (fromSocket && fromSocket.isLocalOnly && !this._busConfig?.passive) {
        process.exitCode = 9;
        setTimeout(() => process.exit(), 10000);
        xLog.err('Exit the node, the socket is lost (max wait of 10s)');
        if (globalBusClient) {
          globalBusClient.command.send('shutdown');
        }
        return;
      }

      xLog.warn(`Attempt a reconnect for ${from}`);

      this._connected = false;

      if (from === 'push') {
        this._subSocket.destroySockets();
      } else if (from === 'sub') {
        this._pushSocket.destroySockets();
      }

      this.emit('reconnect attempt');

      this._registerAutoconnect(() => {
        this.emit('reconnect');
      });

      this._autoconnect = autoconnect.yes;
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
      .on('reconnect attempt', () => {
        this._subClosed = true;
        onReconnectAttempt('sub');
      });

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
      .on('reconnect attempt', () => {
        this._pushClosed = true;
        onReconnectAttempt('push');
      });

    this._subSocket.on('message', (topic, msg) => {
      if (topic === 'gameover') {
        xLog.info('Game Over');
        this._connected = false;
        this.stop();
        return;
      }

      if (topic.startsWith('greathall::')) {
        if (topic === 'greathall::heartbeat') {
          if (
            this._autoconnect === autoconnect.wait &&
            Date.now() - this._autoconnectDelay > 5000
          ) {
            /* Try a new autoconnect after 5 seconds */
            this._autoconnect = autoconnect.yes;
          }

          if (this._autoconnect === autoconnect.yes) {
            this._autoconnect = autoconnect.wait;
            this._autoconnectDelay = Date.now();

            autoConnectToken = xUtils.crypto.genToken();
            this._subSocket.subscribe(
              autoConnectToken + '::autoconnect.finished'
            );
            this.command.send(
              'autoconnect',
              {
                autoConnectToken,
                nice: this._busConfig ? this._busConfig.nice : 0,
                noForwarding: this._busConfig
                  ? this._busConfig.noForwarding || false
                  : false,
              },
              'greathall'
            );
          }
          return;
        }

        if (topic === 'greathall::bus.commands.registry') {
          this._updateCommandsRegistry(msg.data.registry, msg.data.token);
          return;
        }

        if (topic === 'greathall::bus.token.changed') {
          this.emit('token.changed', msg.data.busConfig);
          return;
        }

        if (
          topic === 'greathall::bus.orcname.changed' &&
          this._token === msg.data.token
        ) {
          this.emit(
            'orcname.changed',
            msg.data.oldOrcName,
            msg.data.newOrcName,
            msg.data.busConfig
          );
          return;
        }

        if (topic === 'greathall::bus.reconnect') {
          switch (msg.data.status) {
            case 'attempt':
              this.emit('reconnect attempt');
              break;
            case 'done':
              this.emit('reconnect');
              break;
          }
          return;
        }
      }

      if (!msg) {
        this._resp.log.warn(`undefined message received via ${topic}`);
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
        this._autoconnect = autoconnect.no;
        return;
      }

      if (!this._connected) {
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
        xLog.verb(() => `notification received: ${topic} for ${orcName}`);
        handlers.forEach((handler) => handler(msg));
      } else if (topic !== 'greathall::heartbeat') {
        xLog.info(
          () =>
            `event sent on ${topic} discarded (no subscriber, current orc: ${orcName})`
        );
      }
    });
  }

  get lastErrorReason() {
    return this.#lastErrorReason;
  }

  _updateCommandsRegistry(registry, token) {
    this._commandsRegistry = registry;
    this._commandsRegistryTime = new Date().toISOString();

    this._commandsNames = Object.assign(
      {},
      ...Object.entries(this._commandsRegistry).map(([key, infos]) => {
        let value =
          (infos.questOptions && infos.questOptions.rankingPredictions) || true;
        return {[key]: value};
      })
    );

    this.emit('commands.registry', null, {
      token,
      time: this._commandsRegistryTime,
    });
  }

  destroyPushSocket() {
    this._pushSocket.destroySockets();
  }

  _registerAutoconnect(callback, err) {
    this.registerEvents('autoconnect.finished', (msg) => {
      const isNewOrcName = this._orcName !== msg.data.orcName;

      if (this._token !== 'invalid') {
        if (this._token !== msg.data.token) {
          xLog.warn(
            `reconnecting to the server has provided a new token: ${this._token} -> ${msg.data.token}`
          );
          this.emit('token.changed', this._busConfig);
        } else if (this._orcName && isNewOrcName) {
          xLog.warn(
            `reconnecting to the server has provided a new orcName: ${this._orcName} -> ${msg.data.orcName}`
          );
          this.emit(
            'orcname.changed',
            this._orcName,
            msg.data.orcName,
            this._busConfig
          );
        }
      }

      this._token = msg.data.token;
      if (!this._orcName) {
        this._orcName = msg.data.orcName;
      }
      this._updateCommandsRegistry(msg.data.cmdRegistry, msg.data.token);

      xLog.info(
        () => this._orcName + ' is serving ' + this._token + ' Great Hall'
      );

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

  #tryToLoadClientKeys(xHost, hordeId) {
    const keyPath = path.join(
      xHost.realmsStorePath,
      `${hordeId}@${xHost.variantId}-key.pem`
    );
    const certPath = path.join(
      xHost.realmsStorePath,
      `${hordeId}@${xHost.variantId}-cert.pem`
    );

    return fse.existsSync(keyPath) && fse.existsSync(certPath)
      ? {keyPath, certPath}
      : null;
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
   * @param {Function} callback - Callback.
   */
  connect(backend, busToken, callback) {
    const fse = require('fs-extra');
    const path = require('node:path');
    const xEtc = require('xcraft-core-etc')();
    const xHost = xEtc ? require('xcraft-core-host') : null;

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
        this._autoconnect = autoconnect.yes;
        return;
      }

      this._connected = true;
      this._token = busToken;
      xLog.verb(() => 'Connected with token: ' + this._token);

      callback();
    });

    let busConfig = this._busConfig;
    if (!busConfig) {
      busConfig = xEtc.load('xcraft-core-bus');
    } else if (
      xEtc &&
      !Object.prototype.hasOwnProperty.call(busConfig, 'clientKeepAlive')
    ) {
      const {clientKeepAlive} = xEtc.load('xcraft-core-bus');
      busConfig.clientKeepAlive = clientKeepAlive;
    }

    /* The TLS certificate is ignored in case of unix socket use */
    if (
      xHost &&
      xHost.resourcesPath &&
      xHost.appArgs().tls !== false &&
      !busConfig.noTLS &&
      !busConfig.unixSocketId &&
      !busConfig.caPath
    ) {
      const resCaPath = path.join(xHost.resourcesPath, 'server-cert.pem');
      if (fse.existsSync(resCaPath)) {
        busConfig.caPath = resCaPath;
        xEtc.saveRun('xcraft-core-busclient', busConfig);
      }
    }

    const options = {
      timeout: busConfig.timeout,
      clientKeepAlive:
        typeof busConfig.clientKeepAlive === 'string'
          ? parseInt(busConfig.clientKeepAlive)
          : busConfig.clientKeepAlive,
      noForwarding: busConfig.noForwarding,
    };

    if (
      xHost &&
      busConfig.gatekeeper &&
      busConfig.hordeId &&
      !busConfig.keyPath &&
      !busConfig.certPath
    ) {
      const keys = this.#tryToLoadClientKeys(xHost, busConfig.hordeId);
      if (keys) {
        const {keyPath, certPath} = keys;
        busConfig.keyPath = keyPath;
        busConfig.certPath = certPath;
        xEtc.saveRun('xcraft-core-busclient', busConfig);
      } else {
        xLog.err(
          `Missing client certificate for ${busConfig.hordeId}@${xHost.variantId}`
        );
      }
    }

    ['caPath', 'keyPath', 'certPath']
      .filter((key) => busConfig[key])
      .forEach((key) => {
        if (
          xHost &&
          xHost.resourcesPath &&
          !busConfig[key].startsWith('base64:') &&
          !path.isAbsolute(busConfig[key])
        ) {
          options[key] = path.join(xHost.resourcesPath, busConfig[key]);
        } else {
          options[key] = busConfig[key];
        }
      });

    this._subSocket.connect(backend, {
      port: parseInt(busConfig.notifierPort),
      host: busConfig.host,
      unixSocketId: busConfig.unixSocketId,
      ...options,
    });
    this._pushSocket.connect(backend, {
      port: parseInt(busConfig.commanderPort),
      host: busConfig.host,
      unixSocketId: busConfig.unixSocketId,
      ...options,
    });
  }

  /**
   * Close the connections on the buses.
   *
   * @param {Function} callback - Callback.
   */
  stop(callback) {
    xLog.verb(() => `Stopping for ${this._orcName || 'greathall'}...`);

    const isConnected = this._connected;

    if (isConnected) {
      const unsubscribe = this._subscribeClose((err) => {
        unsubscribe();
        if (callback) {
          callback(err);
        }
      });
    }

    this._connected = false;
    this._subSocket.stop();
    this._pushSocket.stop();

    if (!isConnected && callback) {
      callback();
    }
  }

  /**
   * Return a new empty message for the commands.
   *
   * The isNested attribute is set when the command is called from the server
   * side but with an orc name.
   *
   * @param {string} topic - Event's topic or command's name.
   * @param {string} which - The sender's identity (orcName).
   * @returns {object} the new message.
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
   * @param {object} msg - Xcraft message.
   */
  patchMessage(msg) {
    msg.token = this.getToken();
  }

  _unregister(id, escapeTopic) {
    this._eventsCache.del(id, escapeTopic);
    delete this._eventsRegistry[escapeTopic];
  }

  registerEvents(topic, handler) {
    const str = topic.str || xUtils.regex.toXcraftRegExpStr(topic);
    const ids = topic.ids || extractIds(topic);
    const reg = topic.reg || new RegExp(str);

    if (this._eventsRegistry[str]) {
      xLog.info(`${topic} already registered, unsub and sub again`);
      this.unregisterEvents(topic);
    }

    const id = ids[ids.length - 1];
    this._eventsCache.set(id, str, reg);
    this._eventsRegistry[str] = {
      topic: reg,
      handler,
      unregister: () => this._unregister(id, str),
    };
  }

  unregisterEvents(topic) {
    const str = topic.str || xUtils.regex.toXcraftRegExpStr(topic);
    if (this._eventsRegistry[str]) {
      this._eventsRegistry[str].unregister();
    }
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

  getCommandsNames() {
    return this._commandsNames;
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

exports.newResponse = function (moduleName, orcName, routing, dataContext) {
  let self = null;
  if (this instanceof BusClient) {
    self = this;
  }

  return new Resp(self, moduleName, orcName, routing, dataContext);
};

exports.initGlobal = function () {
  globalBusClient = new BusClient();
  return globalBusClient;
};

exports.getGlobal = function () {
  return globalBusClient;
};

exports.BusClient = BusClient;
